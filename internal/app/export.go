package app

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// exportName is the alphabet of an export file name: no folder separators,
// no spaces, nothing that needs quoting on any system.
var exportName = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// exportsDir is the folder exports are written to: exports/ next to the
// project file.
func (s *Server) exportsDir() string {
	return filepath.Join(filepath.Dir(s.cfg.File), "exports")
}

// validExportName reports whether name may be used as a file name in the
// exports folder on every supported system.
func validExportName(name string) bool {
	if len(name) == 0 || len(name) > 128 || name == "." || name == ".." || !exportName.MatchString(name) {
		return false
	}
	// Windows silently drops trailing dots, so "a.csv." would become "a.csv".
	if strings.HasSuffix(name, ".") {
		return false
	}
	// Windows maps these names to devices, whatever the extension.
	stem := strings.ToUpper(name)
	if i := strings.IndexByte(stem, '.'); i >= 0 {
		stem = stem[:i]
	}
	switch stem {
	case "CON", "PRN", "AUX", "NUL":
		return false
	}
	if len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) &&
		stem[3] >= '0' && stem[3] <= '9' {
		return false
	}
	return true
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	body, ok := readBody(w, r, maxExportBytes, "The export is too large.")
	if !ok {
		return
	}
	var req struct {
		Name    *string `json:"name"`
		Content *string `json:"content"`
	}
	if err := json.Unmarshal(body, &req); err != nil || req.Name == nil || req.Content == nil {
		writeError(w, http.StatusBadRequest, "Invalid request.")
		return
	}
	if !validExportName(*req.Name) {
		writeError(w, http.StatusBadRequest, "Invalid file name.")
		return
	}

	dir := s.exportsDir()
	target := filepath.Join(dir, *req.Name)
	s.exportsMu.Lock()
	err := os.MkdirAll(dir, 0o755)
	if err == nil {
		perm := fs.FileMode(0o644)
		if info, statErr := os.Stat(target); statErr == nil {
			perm = info.Mode().Perm()
		}
		err = writeFileAtomic(target, []byte(*req.Content), perm)
	}
	s.exportsMu.Unlock()
	if err != nil {
		s.cfg.Logf("export %s: %v", target, err)
		writeError(w, http.StatusInternalServerError, "Could not write the file.")
		return
	}
	s.cfg.Logf("exported %s", target)
	writeJSON(w, http.StatusOK, map[string]string{"path": target})
}

func (s *Server) handleReveal(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path *string `json:"path"`
	}
	if !readJSON(w, r, maxSmallBytes, &req) {
		return
	}
	if req.Path == nil {
		writeError(w, http.StatusBadRequest, "Invalid request.")
		return
	}
	target, status := s.resolveExport(*req.Path)
	switch status {
	case http.StatusOK:
	case http.StatusNotFound:
		writeError(w, status, "File not found.")
		return
	default:
		s.cfg.Logf("refused to reveal %q", *req.Path)
		writeError(w, http.StatusForbidden, "Only files in the exports folder can be shown.")
		return
	}
	if err := s.cfg.Reveal(target); err != nil {
		s.cfg.Logf("reveal %s: %v", target, err)
		writeError(w, http.StatusInternalServerError, "Could not open the file manager.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// resolveExport checks that p names an existing file or folder inside the
// exports folder, both as written and after following symbolic links, and
// returns its resolved path with 200. It returns 403 for anything outside
// and 404 for an export that no longer exists.
func (s *Server) resolveExport(p string) (string, int) {
	if !filepath.IsAbs(p) {
		return "", http.StatusForbidden
	}
	p = filepath.Clean(p)
	dir := s.exportsDir()
	if !isInside(dir, p) {
		return "", http.StatusForbidden
	}
	real, err := filepath.EvalSymlinks(p)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "", http.StatusNotFound
		}
		return "", http.StatusForbidden
	}
	realDir, err := filepath.EvalSymlinks(dir)
	if err != nil || !isInside(realDir, real) {
		return "", http.StatusForbidden
	}
	return real, http.StatusOK
}

// isInside reports whether p lies strictly below dir. Both must be clean
// absolute paths.
func isInside(dir, p string) bool {
	rel, err := filepath.Rel(dir, p)
	if err != nil || rel == "." || filepath.IsAbs(rel) {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
