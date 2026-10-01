package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// errConflict means the project file on disk is not the version the page
// last loaded.
var errConflict = errors.New("the file changed on disk")

// store reads and writes the project file. One mutex serializes every
// operation, so a save never interleaves with another save or a read.
type store struct {
	mu   sync.Mutex
	path string
}

// etagOf is the entity tag of a project: the hex SHA-256 of its bytes.
func etagOf(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// read returns the project file as it is on disk.
func (s *store) read() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return os.ReadFile(s.path)
}

// save replaces the project file with data if cond holds, keeps the previous
// content in <file>.bak and returns the new entity tag.
//
// If the file exists, cond must name its current tag or be "*". If it does
// not, cond must be absent or "*". Otherwise save returns errConflict.
func (s *store) save(data []byte, cond ifMatch) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	old, err := os.ReadFile(s.path)
	exists := err == nil
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	if exists {
		if !cond.allows(etagOf(old)) {
			return "", errConflict
		}
	} else if cond.present && !cond.any {
		return "", errConflict
	}
	tag := etagOf(data)
	if exists && bytes.Equal(old, data) {
		// Nothing to write; leave the backup of the real previous version.
		return tag, nil
	}

	perm := fs.FileMode(0o644)
	if exists {
		if info, err := os.Stat(s.path); err == nil {
			perm = info.Mode().Perm()
		}
		if err := writeFileAtomic(s.path+".bak", old, perm); err != nil {
			return "", err
		}
	}
	if err := writeFileAtomic(s.path, data, perm); err != nil {
		return "", err
	}
	syncDir(filepath.Dir(s.path))
	return tag, nil
}

// ifMatch is a parsed If-Match header.
type ifMatch struct {
	present bool     // the header was sent with at least one entry
	any     bool     // one entry was "*"
	tags    []string // the other entries, without quotes
}

// parseIfMatch reads If-Match. Entity tags are accepted with or without
// quotes, and several may be listed.
func parseIfMatch(h http.Header) ifMatch {
	var m ifMatch
	for _, line := range h.Values("If-Match") {
		for _, item := range strings.Split(line, ",") {
			item = strings.TrimSpace(item)
			item = strings.TrimPrefix(item, "W/")
			item = strings.Trim(item, `"`)
			if item == "" {
				continue
			}
			m.present = true
			if item == "*" {
				m.any = true
			} else {
				m.tags = append(m.tags, item)
			}
		}
	}
	return m
}

// allows reports whether the header permits replacing a file whose current
// entity tag is current.
func (m ifMatch) allows(current string) bool {
	if m.any {
		return true
	}
	for _, t := range m.tags {
		if strings.EqualFold(t, current) {
			return true
		}
	}
	return false
}

// writeFileAtomic replaces path with data: it writes a temporary file in the
// same folder, flushes it to disk and renames it over path, so a reader or a
// crash sees either the old content or the new one, never a mix.
func writeFileAtomic(path string, data []byte, perm fs.FileMode) (err error) {
	dir, base := filepath.Split(path)
	f, err := os.CreateTemp(dir, "."+base+".*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer func() {
		if err != nil {
			_ = f.Close()
			_ = os.Remove(tmp)
		}
	}()
	if _, err = f.Write(data); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Chmod(tmp, perm); err != nil {
		return err
	}
	return renameFile(tmp, path)
}

// renameFile renames from to to. On Windows a virus scanner or a sync client
// may hold the target open for a moment, so the rename is retried briefly.
func renameFile(from, to string) error {
	var err error
	for attempt := 1; attempt <= 10; attempt++ {
		err = os.Rename(from, to)
		if err == nil || runtime.GOOS != "windows" {
			return err
		}
		time.Sleep(time.Duration(attempt) * 20 * time.Millisecond)
	}
	return err
}

// syncDir flushes a folder's entries, so a rename survives a power cut.
// Windows offers no way to do this; it is skipped there.
func syncDir(dir string) {
	if runtime.GOOS == "windows" {
		return
	}
	d, err := os.Open(dir)
	if err != nil {
		return
	}
	_ = d.Sync()
	_ = d.Close()
}

// checkProject accepts a body that is a JSON object whose "format" is
// "zwetag-project". It returns the message for a 400 answer otherwise.
func checkProject(body []byte) (string, bool) {
	if !json.Valid(body) {
		return "Invalid JSON.", false
	}
	// A map keeps key matching exact, as in the browser; decoding into a
	// struct would also accept "Format".
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(body, &obj); err != nil || obj == nil {
		return "Not a ZweTag project.", false
	}
	var format string
	raw, ok := obj["format"]
	if !ok || json.Unmarshal(raw, &format) != nil || format != "zwetag-project" {
		return "Not a ZweTag project.", false
	}
	return "", true
}

func (s *Server) handleGetProject(w http.ResponseWriter) {
	data, err := s.store.read()
	if errors.Is(err, fs.ErrNotExist) {
		writeError(w, http.StatusNotFound, "No project file.")
		return
	}
	if err != nil {
		s.cfg.Logf("read project: %v", err)
		writeError(w, http.StatusInternalServerError, "Could not read the project.")
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/json")
	h.Set("ETag", `"`+etagOf(data)+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) handlePutProject(w http.ResponseWriter, r *http.Request) {
	body, ok := readBody(w, r, maxProjectBytes, "The project is larger than 16 MiB.")
	if !ok {
		return
	}
	if msg, ok := checkProject(body); !ok {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	tag, err := s.store.save(body, parseIfMatch(r.Header))
	if errors.Is(err, errConflict) {
		s.cfg.Logf("save refused: the file changed on disk")
		writeError(w, http.StatusConflict, "The file changed on disk.")
		return
	}
	if err != nil {
		s.cfg.Logf("save project: %v", err)
		writeError(w, http.StatusInternalServerError, "Could not save the project.")
		return
	}
	w.Header().Set("ETag", `"`+tag+`"`)
	w.WriteHeader(http.StatusNoContent)
}
