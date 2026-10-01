package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/zweken/zwetag/web"
)

// testAddr is the listener address the fixture server believes it has.
const testAddr = "127.0.0.1:43210"

var testAssets = fstest.MapFS{
	"index.html":          {Data: []byte("<!doctype html><title>ZweTag</title>")},
	"assets/app.js":       {Data: []byte("export {};\n")},
	"assets/app.css":      {Data: []byte("body {}\n")},
	"assets/views/one.js": {Data: []byte("export {};\n")},
	"brand/favicon.svg":   {Data: []byte("<svg/>")},
	"brand/icon.png":      {Data: []byte{0x89, 'P', 'N', 'G'}},
	"brand/app.ico":       {Data: []byte{0, 0, 1, 0}},
	"site.webmanifest":    {Data: []byte("{}")},
	"data.json":           {Data: []byte("{}")},
}

// fixture is a server on a temporary project folder, driven through
// ServeHTTP, with the operating system calls replaced by recorders.
type fixture struct {
	t        *testing.T
	srv      *Server
	dir      string
	file     string
	mu       sync.Mutex
	opened   []string
	revealed []string
	failOS   error
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	dir := t.TempDir()
	f := &fixture{t: t, dir: dir, file: filepath.Join(dir, "zwetag.json")}
	srv, err := New(Config{
		File:    f.file,
		Version: "1.2.3",
		Addr:    testAddr,
		Assets:  testAssets,
		OpenURL: func(u string) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.opened = append(f.opened, u)
			return f.failOS
		},
		Reveal: func(p string) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.revealed = append(f.revealed, p)
			return f.failOS
		},
		Logf: t.Logf,
	})
	if err != nil {
		t.Fatal(err)
	}
	f.srv = srv
	return f
}

// do sends one request with the headers the interface sends. hdr holds
// name/value pairs that replace them; an empty value removes the header.
// The request carries a deadline, so a guard that wrongly lets a request
// through to the event stream fails the test instead of hanging it.
func (f *fixture) do(method, target, body string, hdr ...string) *httptest.ResponseRecorder {
	f.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req := httptest.NewRequestWithContext(ctx, method, target, strings.NewReader(body))
	req.Host = testAddr
	req.Header.Set("X-ZweTag", "1")
	for i := 0; i+1 < len(hdr); i += 2 {
		switch {
		case hdr[i] == "Host":
			req.Host = hdr[i+1]
		case hdr[i+1] == "":
			req.Header.Del(hdr[i])
		default:
			req.Header.Set(hdr[i], hdr[i+1])
		}
	}
	rec := httptest.NewRecorder()
	f.srv.ServeHTTP(rec, req)
	return rec
}

func (f *fixture) calls() (opened, revealed []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.opened...), append([]string(nil), f.revealed...)
}

// expect checks the status code and, when msg is not empty, the JSON error.
func expect(t *testing.T, rec *httptest.ResponseRecorder, code int, msg string) {
	t.Helper()
	if rec.Code != code {
		t.Fatalf("status %d, want %d (body %q)", rec.Code, code, rec.Body.String())
	}
	if msg == "" {
		return
	}
	want := `{"error":"` + msg + `"}`
	if got := rec.Body.String(); got != want {
		t.Fatalf("body %s, want %s", got, want)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type %q, want application/json", ct)
	}
}

func TestNewRejectsUnsafeConfig(t *testing.T) {
	abs := filepath.Join(t.TempDir(), "zwetag.json")
	cases := []Config{
		{File: "zwetag.json", Addr: testAddr, Assets: testAssets},
		{File: abs, Addr: "0.0.0.0:8080", Assets: testAssets},
		{File: abs, Addr: "192.0.2.10:8080", Assets: testAssets},
		{File: abs, Addr: "[::1]:8080", Assets: testAssets},
		{File: abs, Addr: ":8080", Assets: testAssets},
		{File: abs, Addr: "127.0.0.1:0", Assets: testAssets},
		{File: abs, Addr: "127.0.0.1", Assets: testAssets},
		{File: abs, Addr: testAddr},
	}
	for _, c := range cases {
		if _, err := New(c); err == nil {
			t.Errorf("New accepted file %q addr %q assets %v", c.File, c.Addr, c.Assets != nil)
		}
	}
}

func TestHostMustBeTheListener(t *testing.T) {
	f := newFixture(t)
	for _, host := range []string{"127.0.0.1:43210", "localhost:43210", "LocalHost:43210"} {
		expect(t, f.do("GET", "/api/meta", "", "Host", host), 200, "")
		expect(t, f.do("GET", "/", "", "Host", host), 200, "")
	}
	refused := []string{
		"evil.example:43210",
		"evil.example",
		"127.0.0.1:43211",
		"localhost:80",
		"127.0.0.1",
		"localhost",
		"",
		"127.0.0.1.nip.io:43210",
		"localhost.:43210",
		"[::1]:43210",
		"0.0.0.0:43210",
	}
	for _, host := range refused {
		for _, target := range []string{"/", "/assets/app.js", "/api/meta", "/api/alive", "/api/project"} {
			rec := f.do("GET", target, "", "Host", host)
			if rec.Code != http.StatusForbidden || rec.Body.String() != `{"error":"Forbidden host."}` {
				t.Errorf("Host %q %s: %d %s, want 403 Forbidden host", host, target, rec.Code, rec.Body.String())
			}
		}
	}
	rec := f.do("PUT", "/api/project", `{"format":"zwetag-project"}`, "Host", "evil.example:43210")
	expect(t, rec, 403, "Forbidden host.")
	if fileExists(f.file) {
		t.Fatal("a refused request wrote the project file")
	}
}

func TestPort80AcceptsHostWithoutPort(t *testing.T) {
	srv, err := New(Config{File: filepath.Join(t.TempDir(), "p.json"), Addr: "127.0.0.1:80", Assets: testAssets})
	if err != nil {
		t.Fatal(err)
	}
	for host, want := range map[string]int{"127.0.0.1": 200, "localhost": 200, "127.0.0.1:80": 200, "evil.example": 403} {
		req := httptest.NewRequest("GET", "/", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("Host %q: %d, want %d", host, rec.Code, want)
		}
	}
}

func TestOriginMustBeTheSameSite(t *testing.T) {
	f := newFixture(t)
	body := `{"format":"zwetag-project","version":1}`
	expect(t, f.do("PUT", "/api/project", body, "Origin", "http://127.0.0.1:43210"), 204, "")
	expect(t, f.do("GET", "/api/meta", "", "Host", "localhost:43210", "Origin", "http://localhost:43210"), 200, "")
	expect(t, f.do("GET", "/", "", "Origin", "http://127.0.0.1:43210"), 200, "")

	refused := []string{
		"http://evil.example",
		"http://evil.example:43210",
		"null",
		"https://127.0.0.1:43210",
		"http://127.0.0.1:43211",
		"http://localhost:43210",
		"http://127.0.0.1:43210/",
		"file://",
	}
	before := readFile(t, f.file)
	for _, origin := range refused {
		for _, c := range []struct{ method, target, body string }{
			{"PUT", "/api/project", `{"format":"zwetag-project","version":2}`},
			{"POST", "/api/export", `{"name":"a.csv","content":"x"}`},
			{"POST", "/api/open", `{"url":"https://www.zweken.com"}`},
			{"GET", "/api/project", ""},
			{"GET", "/api/alive", ""},
			{"GET", "/", ""},
		} {
			rec := f.do(c.method, c.target, c.body, "Origin", origin)
			if rec.Code != http.StatusForbidden || rec.Body.String() != `{"error":"Forbidden origin."}` {
				t.Errorf("Origin %q %s %s: %d %s, want 403 Forbidden origin", origin, c.method, c.target, rec.Code, rec.Body.String())
			}
		}
	}
	if got := readFile(t, f.file); got != before {
		t.Fatal("a cross-origin request changed the project file")
	}
	if fileExists(filepath.Join(f.dir, "exports")) {
		t.Fatal("a cross-origin request wrote an export")
	}
	if opened, _ := f.calls(); len(opened) != 0 {
		t.Fatalf("a cross-origin request opened %v", opened)
	}

	// Two Origin headers are never sent by a browser.
	req := httptest.NewRequest("GET", "/api/meta", nil)
	req.Host = testAddr
	req.Header.Set("X-ZweTag", "1")
	req.Header.Add("Origin", "http://127.0.0.1:43210")
	req.Header.Add("Origin", "http://evil.example")
	rec := httptest.NewRecorder()
	f.srv.ServeHTTP(rec, req)
	expect(t, rec, 403, "Forbidden origin.")
}

func TestAPIRequiresTheZweTagHeader(t *testing.T) {
	f := newFixture(t)
	writeFile(t, f.file, `{"format":"zwetag-project"}`)
	exportsFile := filepath.Join(f.dir, "exports", "a.csv")
	writeFile(t, exportsFile, "x")

	requests := []struct{ method, target, body string }{
		{"GET", "/api/meta", ""},
		{"GET", "/api/project", ""},
		{"PUT", "/api/project", `{"format":"zwetag-project","version":2}`},
		{"POST", "/api/export", `{"name":"b.csv","content":"y"}`},
		{"POST", "/api/reveal", `{"path":` + jsonString(exportsFile) + `}`},
		{"POST", "/api/open", `{"url":"https://www.zweken.com"}`},
		{"GET", "/api/missing", ""},
		{"GET", "/api", ""},
		{"OPTIONS", "/api/project", ""},
	}
	for _, c := range requests {
		for _, value := range []string{"", "0", "true", "1 "} {
			rec := f.do(c.method, c.target, c.body, "X-ZweTag", value)
			if rec.Code != http.StatusForbidden || rec.Body.String() != `{"error":"Missing X-ZweTag header."}` {
				t.Errorf("%s %s with X-ZweTag %q: %d %s, want 403", c.method, c.target, value, rec.Code, rec.Body.String())
			}
		}
	}
	if got := readFile(t, f.file); got != `{"format":"zwetag-project"}` {
		t.Fatalf("project file changed to %q", got)
	}
	if fileExists(filepath.Join(f.dir, "exports", "b.csv")) {
		t.Fatal("an export was written without the header")
	}
	if opened, revealed := f.calls(); len(opened)+len(revealed) != 0 {
		t.Fatalf("operating system called without the header: %v %v", opened, revealed)
	}

	// Files of the interface are loaded by <script> and <link>, which
	// cannot send headers.
	for _, target := range []string{"/", "/assets/app.js", "/brand/favicon.svg"} {
		expect(t, f.do("GET", target, "", "X-ZweTag", ""), 200, "")
	}
}

func TestSecurityHeadersOnEveryResponse(t *testing.T) {
	f := newFixture(t)
	responses := map[string]*httptest.ResponseRecorder{
		"index":        f.do("GET", "/", ""),
		"script":       f.do("GET", "/assets/app.js", ""),
		"missing file": f.do("GET", "/missing.js", ""),
		"folder":       f.do("GET", "/assets/", ""),
		"post file":    f.do("POST", "/", ""),
		"meta":         f.do("GET", "/api/meta", ""),
		"no project":   f.do("GET", "/api/project", ""),
		"bad body":     f.do("PUT", "/api/project", "{"),
		"no header":    f.do("GET", "/api/meta", "", "X-ZweTag", ""),
		"bad host":     f.do("GET", "/", "", "Host", "evil.example"),
		"bad origin":   f.do("GET", "/api/meta", "", "Origin", "http://evil.example"),
		"bad method":   f.do("DELETE", "/api/project", ""),
		"unknown api":  f.do("GET", "/api/nothing", ""),
	}
	for name, rec := range responses {
		h := rec.Header()
		if got := h.Get("Content-Security-Policy"); got != "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'" {
			t.Errorf("%s: Content-Security-Policy %q", name, got)
		}
		if got := h.Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s: X-Content-Type-Options %q", name, got)
		}
		if got := h.Get("Referrer-Policy"); got != "no-referrer" {
			t.Errorf("%s: Referrer-Policy %q", name, got)
		}
	}
	for _, name := range []string{"meta", "no project", "bad body", "no header", "bad method", "unknown api"} {
		if got := responses[name].Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s: Cache-Control %q, want no-store", name, got)
		}
	}
}

func TestStaticFiles(t *testing.T) {
	f := newFixture(t)
	types := map[string]string{
		"/":                    "text/html; charset=utf-8",
		"/index.html":          "text/html; charset=utf-8",
		"/assets/app.js":       "text/javascript; charset=utf-8",
		"/assets/views/one.js": "text/javascript; charset=utf-8",
		"/assets/app.css":      "text/css; charset=utf-8",
		"/brand/favicon.svg":   "image/svg+xml",
		"/brand/icon.png":      "image/png",
		"/brand/app.ico":       "image/x-icon",
		"/site.webmanifest":    "application/manifest+json",
		"/data.json":           "application/json",
	}
	for target, ctype := range types {
		rec := f.do("GET", target, "", "X-ZweTag", "")
		if rec.Code != 200 || rec.Header().Get("Content-Type") != ctype {
			t.Errorf("GET %s: %d %q, want 200 %q", target, rec.Code, rec.Header().Get("Content-Type"), ctype)
		}
	}
	if got := f.do("GET", "/", "").Body.String(); got != "<!doctype html><title>ZweTag</title>" {
		t.Errorf("GET / served %q", got)
	}
	for _, target := range []string{"/assets", "/assets/", "/brand/", "/assets/views", "/nothing.js",
		"/assets/../../go.mod", "/api.js/../assets", "/%2e%2e/go.mod"} {
		if rec := f.do("GET", target, ""); rec.Code != http.StatusNotFound {
			t.Errorf("GET %s: %d, want 404", target, rec.Code)
		}
	}
	for _, method := range []string{"POST", "PUT", "DELETE"} {
		if rec := f.do(method, "/", ""); rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s /: %d, want 405", method, rec.Code)
		}
	}
	if rec := f.do("HEAD", "/assets/app.js", ""); rec.Code != 200 || rec.Body.Len() != 0 {
		t.Errorf("HEAD: %d with %d body bytes", rec.Code, rec.Body.Len())
	}
}

func TestEmbeddedInterface(t *testing.T) {
	srv, err := New(Config{File: filepath.Join(t.TempDir(), "zwetag.json"), Addr: testAddr, Assets: web.FS})
	if err != nil {
		t.Fatal(err)
	}
	for target, ctype := range map[string]string{
		"/":                          "text/html; charset=utf-8",
		"/assets/engine.js":          "text/javascript; charset=utf-8",
		"/brand/favicon/favicon.svg": "image/svg+xml",
		"/brand/lockup/lockup.svg":   "image/svg+xml",
	} {
		req := httptest.NewRequest("GET", target, nil)
		req.Host = testAddr
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		if rec.Code != 200 || rec.Header().Get("Content-Type") != ctype || rec.Body.Len() == 0 {
			t.Errorf("GET %s: %d %q, %d bytes", target, rec.Code, rec.Header().Get("Content-Type"), rec.Body.Len())
		}
	}
}

func TestMeta(t *testing.T) {
	f := newFixture(t)
	meta := func(exists string) {
		t.Helper()
		rec := f.do("GET", "/api/meta", "")
		expect(t, rec, 200, "")
		want := `{"app":"ZweTag","version":"1.2.3","mode":"desktop","file":` + jsonString(f.file) + `,"exists":` + exists + `}`
		if got := rec.Body.String(); got != want {
			t.Fatalf("meta %s, want %s", got, want)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
			t.Fatalf("Content-Type %q", ct)
		}
	}
	// "exists" follows the file on disk at the moment of each request.
	meta("false")
	expect(t, f.do("PUT", "/api/project", `{"format":"zwetag-project"}`), 204, "")
	meta("true")
	if err := os.Remove(f.file); err != nil {
		t.Fatal(err)
	}
	meta("false")
	if err := os.Mkdir(f.file, 0o755); err != nil {
		t.Fatal(err)
	}
	meta("false") // a folder is not a project file
	if rec := f.do("POST", "/api/meta", ""); rec.Code != http.StatusMethodNotAllowed || rec.Header().Get("Allow") != "GET" {
		t.Fatalf("POST /api/meta: %d Allow %q", rec.Code, rec.Header().Get("Allow"))
	}
	expect(t, f.do("GET", "/api/nothing", ""), 404, "Not found.")
}

func TestOpenOnlyTheTwoAddresses(t *testing.T) {
	f := newFixture(t)
	for _, u := range []string{"https://github.com/zweken/ZweTag", "https://www.zweken.com"} {
		expect(t, f.do("POST", "/api/open", `{"url":`+jsonString(u)+`}`), 204, "")
	}
	refused := []string{
		"https://github.com/zweken/ZweTag/",
		"https://github.com/zweken/zwetag",
		"https://github.com/zweken/ZweTag/releases",
		"https://www.zweken.com/",
		"http://www.zweken.com",
		"https://zweken.com",
		"https://www.zweken.com.evil.example",
		"https://evil.example",
		"file:///etc/passwd",
		"javascript:alert(1)",
		"calc.exe",
		"",
	}
	for _, u := range refused {
		expect(t, f.do("POST", "/api/open", `{"url":`+jsonString(u)+`}`), 403, "This address is not allowed.")
	}
	expect(t, f.do("POST", "/api/open", `{"url":1}`), 400, "Invalid request.")
	expect(t, f.do("POST", "/api/open", `{}`), 400, "Invalid request.")
	expect(t, f.do("POST", "/api/open", `not json`), 400, "Invalid request.")
	opened, _ := f.calls()
	if strings.Join(opened, " ") != "https://github.com/zweken/ZweTag https://www.zweken.com" {
		t.Fatalf("opened %q", opened)
	}

	f.failOS = errors.New("no browser")
	expect(t, f.do("POST", "/api/open", `{"url":"https://www.zweken.com"}`), 500, "Could not open the browser.")
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
