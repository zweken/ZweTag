//go:build !windows

package main

import (
	"os/exec"
	"path/filepath"
	"runtime"
)

// openWindow reports that there is no native window outside Windows; the
// caller opens the default browser instead.
func openWindow(string) bool { return false }

// revealFile shows path in the system file manager: Finder selects the file,
// other systems open the folder that holds it.
func revealFile(path string) error {
	if runtime.GOOS == "darwin" {
		return startDetached(exec.Command("open", "-R", path))
	}
	return startDetached(exec.Command("xdg-open", filepath.Dir(path)))
}
