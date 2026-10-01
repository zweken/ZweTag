package app

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// bom is the UTF-8 byte order mark the interface puts in front of a CSV.
var bom = string(rune(0xFEFF))

func exportBody(name, content string) string {
	b, _ := json.Marshal(map[string]string{"name": name, "content": content})
	return string(b)
}

func exportPath(t *testing.T, f *fixture, name, content string) string {
	t.Helper()
	rec := f.do("POST", "/api/export", exportBody(name, content))
	expect(t, rec, 200, "")
	var out struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.Path
}

func TestExportWritesIntoExports(t *testing.T) {
	f := newFixture(t)
	content := bom + "code,end_a,end_b\r\nC0001,A01-40:01,\"A02-38:01\"\r\n"
	p := exportPath(t, f, "zwetag-cables.csv", content)
	want := filepath.Join(f.dir, "exports", "zwetag-cables.csv")
	if p != want {
		t.Fatalf("path %q, want %q", p, want)
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != content || !strings.HasPrefix(string(raw), "\xef\xbb\xbf") {
		t.Fatalf("file holds %q", raw)
	}

	// The same name again overwrites.
	exportPath(t, f, "zwetag-cables.csv", "second")
	if readFile(t, want) != "second" {
		t.Fatal("export was not overwritten")
	}
	exportPath(t, f, strings.Repeat("a", 128), "")
	if got := strings.Join(listDir(t, filepath.Join(f.dir, "exports")), " "); got != strings.Repeat("a", 128)+" zwetag-cables.csv" {
		t.Fatalf("exports holds %s", got)
	}
}

func TestExportRejectsNamesWithPaths(t *testing.T) {
	f := newFixture(t)
	names := []string{
		"",
		".",
		"..",
		"...",
		"../zwetag.json",
		"../../evil.csv",
		"sub/a.csv",
		`sub\a.csv`,
		`..\evil.csv`,
		"/tmp/evil.csv",
		`C:\evil.csv`,
		"C:evil.csv",
		"a b.csv",
		"a.csv.",
		"tab\t.csv",
		"nul\x00.csv",
		"caf" + string(rune(0xE9)) + ".csv",
		strings.Repeat("a", 129),
		"CON",
		"nul.csv",
		"Aux.txt",
		"COM1.csv",
		"lpt9",
	}
	for _, name := range names {
		expect(t, f.do("POST", "/api/export", exportBody(name, "x")), 400, "Invalid file name.")
	}
	for _, body := range []string{"", "{", `{"name":"a.csv"}`, `{"content":"x"}`, `{"name":1,"content":"x"}`, `[]`} {
		expect(t, f.do("POST", "/api/export", body), 400, "Invalid request.")
	}
	if got := strings.Join(listDir(t, f.dir), " "); got != "" {
		t.Fatalf("rejected exports left %s", got)
	}
	if fileExists(filepath.Join(filepath.Dir(f.dir), "evil.csv")) {
		t.Fatal("an export escaped the project folder")
	}
}

func TestRevealOnlyInsideExports(t *testing.T) {
	f := newFixture(t)
	writeFile(t, f.file, project(1))
	inside := exportPath(t, f, "labels.csv", "x")

	expect(t, f.do("POST", "/api/reveal", `{"path":`+jsonString(inside)+`}`), 204, "")
	if _, revealed := f.calls(); len(revealed) != 1 || revealed[0] != inside {
		t.Fatalf("revealed %q, want %q", revealed, inside)
	}

	writeFile(t, filepath.Join(f.dir, "exportsextra", "a.csv"), "x")
	outside := []string{
		f.file,
		f.dir,
		filepath.Join(f.dir, "exports"),
		filepath.Join(f.dir, "exports") + string(filepath.Separator),
		filepath.Join(f.dir, "exports", "..", "zwetag.json"),
		filepath.Join(f.dir, "exportsextra", "a.csv"),
		filepath.Join("exports", "labels.csv"),
		"labels.csv",
		"",
		filepath.Dir(f.dir),
	}
	if runtime.GOOS == "windows" {
		outside = append(outside, `C:\Windows\System32\drivers\etc\hosts`)
	} else {
		outside = append(outside, "/etc/passwd", "/")
		// A link inside exports/ that points outside it.
		link := filepath.Join(f.dir, "exports", "link.csv")
		if err := os.Symlink(f.file, link); err != nil {
			t.Fatal(err)
		}
		outside = append(outside, link)
	}
	for _, p := range outside {
		expect(t, f.do("POST", "/api/reveal", `{"path":`+jsonString(p)+`}`), 403, "Only files in the exports folder can be shown.")
	}

	expect(t, f.do("POST", "/api/reveal", `{"path":`+jsonString(filepath.Join(f.dir, "exports", "gone.csv"))+`}`), 404, "File not found.")
	expect(t, f.do("POST", "/api/reveal", `{"path":1}`), 400, "Invalid request.")
	expect(t, f.do("POST", "/api/reveal", `{}`), 400, "Invalid request.")
	if _, revealed := f.calls(); len(revealed) != 1 {
		t.Fatalf("refused paths reached the file manager: %q", revealed)
	}

	f.failOS = errors.New("no file manager")
	expect(t, f.do("POST", "/api/reveal", `{"path":`+jsonString(inside)+`}`), 500, "Could not open the file manager.")
}

func TestValidExportName(t *testing.T) {
	for _, name := range []string{"a", "a.csv", "zwetag-labels_2026-10-01.csv", ".hidden", "a..b", "COM10.csv", "CONSOLE.txt", "LPT.csv"} {
		if !validExportName(name) {
			t.Errorf("%q rejected", name)
		}
	}
}
