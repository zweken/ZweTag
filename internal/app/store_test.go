package app

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
)

func fileExists(p string) bool {
	_, err := os.Lstat(p)
	return err == nil
}

func readFile(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func writeFile(t *testing.T, p, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func listDir(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	return names
}

func quotedTag(content string) string {
	sum := sha256.Sum256([]byte(content))
	return `"` + hex.EncodeToString(sum[:]) + `"`
}

func project(n int) string {
	return fmt.Sprintf(`{"format":"zwetag-project","version":1,"name":"Room %d"}`, n)
}

func TestProjectRoundTrip(t *testing.T) {
	f := newFixture(t)
	expect(t, f.do("GET", "/api/project", ""), 404, "No project file.")

	rec := f.do("PUT", "/api/project", project(1))
	expect(t, rec, 204, "")
	if got := rec.Header().Get("ETag"); got != quotedTag(project(1)) {
		t.Fatalf("ETag %q, want %q", got, quotedTag(project(1)))
	}
	if got := readFile(t, f.file); got != project(1) {
		t.Fatalf("file holds %q", got)
	}
	if fileExists(f.file + ".bak") {
		t.Fatal("a backup was made of a file that did not exist")
	}

	rec = f.do("GET", "/api/project", "")
	expect(t, rec, 200, "")
	if rec.Body.String() != project(1) || rec.Header().Get("ETag") != quotedTag(project(1)) ||
		rec.Header().Get("Content-Type") != "application/json" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("GET: %q ETag %q type %q cache %q", rec.Body.String(), rec.Header().Get("ETag"),
			rec.Header().Get("Content-Type"), rec.Header().Get("Cache-Control"))
	}
}

func TestProjectSaveIsAtomicAndKeepsABackup(t *testing.T) {
	f := newFixture(t)
	expect(t, f.do("PUT", "/api/project", project(1)), 204, "")
	before, err := os.Stat(f.file)
	if err != nil {
		t.Fatal(err)
	}

	expect(t, f.do("PUT", "/api/project", project(2), "If-Match", quotedTag(project(1))), 204, "")
	if readFile(t, f.file) != project(2) || readFile(t, f.file+".bak") != project(1) {
		t.Fatalf("after second save: file %q, backup %q", readFile(t, f.file), readFile(t, f.file+".bak"))
	}
	after, err := os.Stat(f.file)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && os.SameFile(before, after) {
		t.Fatal("the project file was rewritten in place, not replaced by a rename")
	}

	// An unquoted tag is accepted too.
	expect(t, f.do("PUT", "/api/project", project(3), "If-Match", strings.Trim(quotedTag(project(2)), `"`)), 204, "")
	if readFile(t, f.file) != project(3) || readFile(t, f.file+".bak") != project(2) {
		t.Fatal("the backup does not hold the version before the last save")
	}

	// Saving identical content changes nothing, so the backup keeps the
	// real previous version.
	rec := f.do("PUT", "/api/project", project(3), "If-Match", quotedTag(project(3)))
	expect(t, rec, 204, "")
	if rec.Header().Get("ETag") != quotedTag(project(3)) || readFile(t, f.file+".bak") != project(2) {
		t.Fatal("an unchanged save replaced the backup")
	}

	if got := strings.Join(listDir(t, f.dir), " "); got != "zwetag.json zwetag.json.bak" {
		t.Fatalf("folder holds %s; temporary files were left behind", got)
	}
}

func TestProjectIfMatch(t *testing.T) {
	f := newFixture(t)
	expect(t, f.do("PUT", "/api/project", project(1)), 204, "")

	for _, cond := range []string{"", `"0000"`, "0000", `"` + strings.Repeat("0", 64) + `"`, ","} {
		hdr := []string{"If-Match", cond}
		expect(t, f.do("PUT", "/api/project", project(9), hdr...), 409, "The file changed on disk.")
	}
	if readFile(t, f.file) != project(1) {
		t.Fatal("a refused save changed the file")
	}

	expect(t, f.do("PUT", "/api/project", project(2), "If-Match", `"abc", `+quotedTag(project(1))), 204, "")
	expect(t, f.do("PUT", "/api/project", project(3), "If-Match", "*"), 204, "")
	if readFile(t, f.file) != project(3) || readFile(t, f.file+".bak") != project(2) {
		t.Fatal(`"*" did not overwrite`)
	}

	// Another program changes the file: the page's tag no longer matches.
	writeFile(t, f.file, project(42))
	expect(t, f.do("PUT", "/api/project", project(4), "If-Match", quotedTag(project(3))), 409, "The file changed on disk.")
	if readFile(t, f.file) != project(42) {
		t.Fatal("the outside change was overwritten")
	}
	rec := f.do("GET", "/api/project", "")
	if rec.Header().Get("ETag") != quotedTag(project(42)) {
		t.Fatal("GET does not report the tag of the outside change")
	}
	expect(t, f.do("PUT", "/api/project", project(5), "If-Match", quotedTag(project(42))), 204, "")

	// The file was deleted: a stale tag conflicts, no tag or "*" recreates it.
	if err := os.Remove(f.file); err != nil {
		t.Fatal(err)
	}
	expect(t, f.do("PUT", "/api/project", project(6), "If-Match", quotedTag(project(5))), 409, "The file changed on disk.")
	if fileExists(f.file) {
		t.Fatal("a conflicting save created the file")
	}
	expect(t, f.do("PUT", "/api/project", project(7), "If-Match", "*"), 204, "")
	if readFile(t, f.file) != project(7) {
		t.Fatal(`"*" did not create the missing file`)
	}
}

func TestProjectRejectsBadBodies(t *testing.T) {
	f := newFixture(t)
	cases := map[string]string{
		"":                               "Invalid JSON.",
		"{":                              "Invalid JSON.",
		`{"format":"zwetag-project"} {}`: "Invalid JSON.",
		"[]":                             "Not a ZweTag project.",
		"null":                           "Not a ZweTag project.",
		`"zwetag-project"`:               "Not a ZweTag project.",
		`{}`:                             "Not a ZweTag project.",
		`{"format":"zwetag-vectors"}`:    "Not a ZweTag project.",
		`{"format":1}`:                   "Not a ZweTag project.",
		`{"Format":"zwetag-project"}`:    "Not a ZweTag project.",
		`{"format":"zwetag-project","format":"other"}`: "Not a ZweTag project.",
	}
	for body, msg := range cases {
		expect(t, f.do("PUT", "/api/project", body), 400, msg)
	}

	pad := func(total int) string {
		head, tail := `{"format":"zwetag-project","pad":"`, `"}`
		return head + strings.Repeat("a", total-len(head)-len(tail)) + tail
	}
	expect(t, f.do("PUT", "/api/project", pad(16<<20+1)), 400, "The project is larger than 16 MiB.")
	if fileExists(f.file) {
		t.Fatal("a rejected body was written")
	}
	expect(t, f.do("PUT", "/api/project", pad(16<<20)), 204, "")
}

func TestProjectConcurrentSavesAreSerialized(t *testing.T) {
	f := newFixture(t)
	expect(t, f.do("PUT", "/api/project", project(0)), 204, "")
	tag := quotedTag(project(0))

	const n = 16
	codes := make([]int, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes[i] = f.do("PUT", "/api/project", project(i+1), "If-Match", tag).Code
		}(i)
	}
	wg.Wait()

	winner := -1
	for i, c := range codes {
		switch c {
		case 204:
			if winner >= 0 {
				t.Fatalf("saves %d and %d both succeeded with the same tag", winner, i)
			}
			winner = i
		case 409:
		default:
			t.Fatalf("save %d: status %d", i, c)
		}
	}
	if winner < 0 {
		t.Fatal("no save succeeded")
	}
	if readFile(t, f.file) != project(winner+1) || readFile(t, f.file+".bak") != project(0) {
		t.Fatal("the file does not hold the one successful save")
	}
}

func TestProjectFailedSaveLeavesTheFile(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("needs a folder the test user cannot write to")
	}
	f := newFixture(t)
	expect(t, f.do("PUT", "/api/project", project(1)), 204, "")
	if err := os.Chmod(f.dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(f.dir, 0o755) })

	expect(t, f.do("PUT", "/api/project", project(2), "If-Match", quotedTag(project(1))), 500, "Could not save the project.")
	if readFile(t, f.file) != project(1) {
		t.Fatal("a failed save damaged the project file")
	}
	if got := strings.Join(listDir(t, f.dir), " "); got != "zwetag.json" {
		t.Fatalf("folder holds %s", got)
	}
}
