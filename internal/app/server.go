// Package app is the local web server behind the ZweTag desktop app. It serves
// the embedded interface and a small JSON API that reads and writes the
// project file, saves exports and asks the operating system to show a folder
// or open a web page. It answers only requests addressed to its own loopback
// listener.
package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ContentSecurityPolicy is sent with every response. index.html carries the
// same policy in a meta element, so the static online copy is covered too.
const ContentSecurityPolicy = "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'"

// allowedURLs are the only addresses POST /api/open will hand to the browser.
var allowedURLs = map[string]bool{
	"https://github.com/zweken/ZweTag": true,
	"https://www.zweken.com":           true,
}

// contentTypes is set explicitly so the result never depends on the MIME
// tables of the host system (on Windows ".js" is often "text/plain", which
// makes browsers refuse ES modules).
var contentTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".mjs":         "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".ico":         "image/x-icon",
	".webmanifest": "application/manifest+json",
	".json":        "application/json",
	".txt":         "text/plain; charset=utf-8",
}

// Request body limits.
const (
	maxProjectBytes = 16 << 20
	maxExportBytes  = 32 << 20
	maxSmallBytes   = 64 << 10
)

// Config describes one server.
type Config struct {
	// File is the absolute path of the project file.
	File string
	// Version is reported by GET /api/meta.
	Version string
	// Addr is the address the listener is bound to, such as
	// 127.0.0.1:49152. The Host header of every request must name it, or
	// localhost with the same port.
	Addr string
	// Assets holds index.html and the assets and brand folders.
	Assets fs.FS
	// OpenURL opens one of the allowed addresses in the default browser.
	OpenURL func(url string) error
	// Reveal shows a file in the system file manager.
	Reveal func(path string) error
	// Logf receives a line for each notable event. Nil discards them.
	Logf func(format string, args ...any)
}

// Server is the local HTTP server.
type Server struct {
	cfg       Config
	hosts     map[string]bool
	store     *store
	exportsMu sync.Mutex
	alive     *alive
	handler   http.Handler
	http      *http.Server
	done      chan struct{}
	closeOnce sync.Once
}

// New checks cfg and builds a server. It does not listen; see Serve.
func New(cfg Config) (*Server, error) {
	if !filepath.IsAbs(cfg.File) {
		return nil, fmt.Errorf("project file path must be absolute: %q", cfg.File)
	}
	host, port, err := net.SplitHostPort(cfg.Addr)
	if err != nil {
		return nil, fmt.Errorf("invalid address %q: %v", cfg.Addr, err)
	}
	if !isLoopbackName(host) {
		return nil, fmt.Errorf("address %q is not 127.0.0.1 or localhost", cfg.Addr)
	}
	if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
		return nil, fmt.Errorf("address %q has no usable port", cfg.Addr)
	}
	if cfg.Assets == nil {
		return nil, errors.New("no interface files")
	}
	if cfg.OpenURL == nil {
		cfg.OpenURL = func(string) error { return errors.ErrUnsupported }
	}
	if cfg.Reveal == nil {
		cfg.Reveal = func(string) error { return errors.ErrUnsupported }
	}
	if cfg.Logf == nil {
		cfg.Logf = func(string, ...any) {}
	}

	s := &Server{
		cfg: cfg,
		hosts: map[string]bool{
			"127.0.0.1:" + port: true,
			"localhost:" + port: true,
		},
		store: &store{path: cfg.File},
		alive: newAlive(),
		done:  make(chan struct{}),
	}
	if port == "80" {
		// Browsers leave the default port out of Host.
		s.hosts["127.0.0.1"] = true
		s.hosts["localhost"] = true
	}
	s.handler = http.HandlerFunc(s.serve)
	s.http = &http.Server{
		Handler:           s.handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	return s, nil
}

// ServeHTTP handles one request.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.handler.ServeHTTP(w, r)
}

// Serve accepts connections on ln, which must be bound to cfg.Addr, until
// Shutdown is called. It returns nil after a shutdown.
func (s *Server) Serve(ln net.Listener) error {
	err := s.http.Serve(ln)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// Shutdown ends the event streams, then stops the server gracefully.
func (s *Server) Shutdown(ctx context.Context) error {
	s.closeOnce.Do(func() {
		close(s.done)
		s.alive.stop()
	})
	return s.http.Shutdown(ctx)
}

// ExitWhenIdle arranges for onIdle to be called once, grace after the last
// page holding GET /api/alive open has gone. A connection that arrives within
// grace (a reload) cancels it. Nothing happens until a page has connected at
// least once.
func (s *Server) ExitWhenIdle(grace time.Duration, onIdle func()) {
	s.alive.enable(grace, onIdle)
}

// serve applies the checks every request must pass, then routes it.
func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Content-Security-Policy", ContentSecurityPolicy)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Frame-Options", "DENY")

	api := r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/")
	if api {
		h.Set("Cache-Control", "no-store")
	}

	// A page on another site can reach this port through a DNS name that
	// resolves to 127.0.0.1 (DNS rebinding); its requests carry that name.
	if !s.hosts[strings.ToLower(r.Host)] {
		s.cfg.Logf("refused %s %s: host %q", r.Method, r.URL.Path, r.Host)
		writeError(w, http.StatusForbidden, "Forbidden host.")
		return
	}
	if origins := r.Header.Values("Origin"); len(origins) > 1 ||
		(len(origins) == 1 && origins[0] != "" && !strings.EqualFold(origins[0], "http://"+r.Host)) {
		s.cfg.Logf("refused %s %s: origin %q", r.Method, r.URL.Path, strings.Join(origins, ", "))
		writeError(w, http.StatusForbidden, "Forbidden origin.")
		return
	}
	if !api {
		s.serveStatic(w, r)
		return
	}
	// EventSource cannot send headers, so the stream is the one exception. A
	// page on another origin cannot send this header without a CORS preflight,
	// which is never granted.
	if r.URL.Path != "/api/alive" && r.Header.Get("X-ZweTag") != "1" {
		s.cfg.Logf("refused %s %s: no X-ZweTag header", r.Method, r.URL.Path)
		writeError(w, http.StatusForbidden, "Missing X-ZweTag header.")
		return
	}

	switch r.URL.Path {
	case "/api/meta":
		if allow(w, r, http.MethodGet) {
			s.handleMeta(w)
		}
	case "/api/project":
		if allow(w, r, http.MethodGet, http.MethodPut) {
			if r.Method == http.MethodGet {
				s.handleGetProject(w)
			} else {
				s.handlePutProject(w, r)
			}
		}
	case "/api/export":
		if allow(w, r, http.MethodPost) {
			s.handleExport(w, r)
		}
	case "/api/reveal":
		if allow(w, r, http.MethodPost) {
			s.handleReveal(w, r)
		}
	case "/api/open":
		if allow(w, r, http.MethodPost) {
			s.handleOpen(w, r)
		}
	case "/api/alive":
		if allow(w, r, http.MethodGet) {
			s.handleAlive(w, r)
		}
	default:
		writeError(w, http.StatusNotFound, "Not found.")
	}
}

// serveStatic serves one file of the interface. "/" is index.html; folders
// and unknown paths are 404.
func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/") {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}
	if !fs.ValidPath(name) {
		http.NotFound(w, r)
		return
	}
	f, err := s.cfg.Assets.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	ctype, ok := contentTypes[strings.ToLower(path.Ext(name))]
	if !ok {
		ctype = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ctype)
	// Always revalidate, so a new build never runs a cached older interface.
	w.Header().Set("Cache-Control", "no-cache")
	content, ok := f.(io.ReadSeeker)
	if !ok {
		data, err := io.ReadAll(f)
		if err != nil {
			http.Error(w, "Could not read the file", http.StatusInternalServerError)
			return
		}
		content = bytes.NewReader(data)
	}
	http.ServeContent(w, r, name, time.Time{}, content)
}

// handleMeta describes the program and its project file. "exists" is
// checked on every request, so the page can tell a first run from a project
// to load without asking for a file that is not there.
func (s *Server) handleMeta(w http.ResponseWriter) {
	info, err := os.Stat(s.cfg.File)
	writeJSON(w, http.StatusOK, struct {
		App     string `json:"app"`
		Version string `json:"version"`
		Mode    string `json:"mode"`
		File    string `json:"file"`
		Exists  bool   `json:"exists"`
	}{"ZweTag", s.cfg.Version, "desktop", s.cfg.File, err == nil && info.Mode().IsRegular()})
}

func (s *Server) handleOpen(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL *string `json:"url"`
	}
	if !readJSON(w, r, maxSmallBytes, &req) {
		return
	}
	if req.URL == nil {
		writeError(w, http.StatusBadRequest, "Invalid request.")
		return
	}
	if !allowedURLs[*req.URL] {
		s.cfg.Logf("refused to open %q", *req.URL)
		writeError(w, http.StatusForbidden, "This address is not allowed.")
		return
	}
	if err := s.cfg.OpenURL(*req.URL); err != nil {
		s.cfg.Logf("open %s: %v", *req.URL, err)
		writeError(w, http.StatusInternalServerError, "Could not open the browser.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// isLoopbackName reports whether host is one of the two names the server
// may be reached by.
func isLoopbackName(host string) bool {
	return host == "127.0.0.1" || strings.EqualFold(host, "localhost")
}

// allow reports whether r uses one of methods, and answers 405 if not.
func allow(w http.ResponseWriter, r *http.Request, methods ...string) bool {
	for _, m := range methods {
		if r.Method == m {
			return true
		}
	}
	w.Header().Set("Allow", strings.Join(methods, ", "))
	writeError(w, http.StatusMethodNotAllowed, "Method not allowed.")
	return false
}

// readBody reads the request body, which may hold at most limit bytes. On
// failure it has already answered 400.
func readBody(w http.ResponseWriter, r *http.Request, limit int64, tooLarge string) ([]byte, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeError(w, http.StatusBadRequest, tooLarge)
		} else {
			writeError(w, http.StatusBadRequest, "Could not read the request.")
		}
		return nil, false
	}
	return body, true
}

// readJSON decodes a small JSON object from the request body into v. On
// failure it has already answered 400.
func readJSON(w http.ResponseWriter, r *http.Request, limit int64, v any) bool {
	body, ok := readBody(w, r, limit, "The request is too large.")
	if !ok {
		return false
	}
	if err := json.Unmarshal(body, v); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request.")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		code = http.StatusInternalServerError
		data = []byte(`{"error":"Internal error."}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = w.Write(data)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
