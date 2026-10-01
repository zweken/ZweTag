// Command zwetag is the ZweTag desktop app. It serves the interface from a
// local web server on 127.0.0.1 and shows it in a WebView2 window on Windows,
// or in the default browser elsewhere. The project is one JSON file, by
// default zwetag.json next to the program.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/zweken/zwetag/internal/app"
	"github.com/zweken/zwetag/web"
)

// Version is set at build time with -ldflags "-X main.Version=...".
var Version = "dev"

// Exit codes.
const (
	exitOK    = 0
	exitError = 1
	exitUsage = 2
)

const (
	projectName = "zwetag.json"
	logName     = "zwetag.log"
	maxLogBytes = 1 << 20
	// idleGrace is how long the browser may be without a ZweTag page before
	// the program exits. A reload reconnects well within it.
	idleGrace = 5 * time.Second
)

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	flags := flag.NewFlagSet("zwetag", flag.ContinueOnError)
	file := flags.String("file", "", "project `file` (default: "+projectName+" next to the program)")
	addr := flags.String("addr", "127.0.0.1:0", "listen `address` on this computer; port 0 picks a free port")
	serverOnly := flags.Bool("server", false, "serve only: no window, no browser, no automatic exit")
	version := flags.Bool("version", false, "print the version and exit")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return exitOK
		}
		return exitUsage
	}
	if *version {
		fmt.Println("ZweTag", Version)
		return exitOK
	}
	// A project file dropped on the program arrives as the only argument.
	switch {
	case flags.NArg() == 1 && *file == "":
		*file = flags.Arg(0)
	case flags.NArg() == 1:
		return usageError("unexpected argument %q; --file is already set", flags.Arg(0))
	case flags.NArg() > 1:
		return usageError("unexpected argument %q; options go before the project file", flags.Arg(1))
	}

	listen, err := loopbackAddr(*addr)
	if err != nil {
		return usageError("%v", err)
	}
	path, err := projectPath(*file)
	if err != nil {
		return usageError("%v", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "zwetag: cannot create %s: %v\n", filepath.Dir(path), err)
		return exitError
	}

	// The Windows build has no console, so the log file is the only trace.
	// It is written first: a write to a missing console fails, and that
	// would stop a MultiWriter before it reached the file.
	if logFile, err := openLog(filepath.Join(filepath.Dir(path), logName)); err == nil {
		defer logFile.Close()
		log.SetOutput(io.MultiWriter(logFile, os.Stderr))
	} else {
		log.Printf("no log file: %v", err)
	}
	log.Printf("ZweTag %s starting; project file %s", Version, path)

	ln, err := net.Listen("tcp", listen)
	if err != nil {
		log.Printf("cannot listen on %s: %v", listen, err)
		return exitError
	}
	srv, err := app.New(app.Config{
		File:    path,
		Version: Version,
		Addr:    ln.Addr().String(),
		Assets:  web.FS,
		OpenURL: openBrowser,
		Reveal:  revealFile,
		Logf:    log.Printf,
	})
	if err != nil {
		_ = ln.Close()
		log.Print(err)
		return exitError
	}
	url := "http://" + ln.Addr().String() + "/"
	log.Printf("listening on %s", url)
	fmt.Printf("ZweTag %s listening on %s\n", Version, url)

	served := make(chan error, 1)
	go func() { served <- srv.Serve(ln) }()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	idle := make(chan struct{}, 1)

	if !*serverOnly {
		// openWindow runs on the main goroutine, which the WebView2 package
		// locks to the main thread. It blocks until the window is closed.
		if openWindow(url) {
			log.Print("window closed")
			return shutdown(srv, exitOK)
		}
		srv.ExitWhenIdle(idleGrace, func() {
			select {
			case idle <- struct{}{}:
			default:
			}
		})
		if err := openBrowser(url); err != nil {
			log.Printf("could not start a browser (%v); open %s by hand", err, url)
		}
	}

	select {
	case err := <-served:
		log.Printf("server stopped: %v", err)
		return shutdown(srv, exitError)
	case s := <-signals:
		log.Printf("%v received", s)
	case <-idle:
		log.Print("no ZweTag page is open any more")
	}
	return shutdown(srv, exitOK)
}

// shutdown stops the server and returns code.
func shutdown(srv *app.Server, code int) int {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
	log.Print("stopped")
	return code
}

func usageError(format string, args ...any) int {
	fmt.Fprintf(os.Stderr, "zwetag: "+format+"\n", args...)
	return exitUsage
}

// loopbackAddr checks --addr and returns the address to listen on. Only
// 127.0.0.1 and localhost are accepted; localhost is bound as 127.0.0.1 so it
// never ends up on another interface or on IPv6 only.
func loopbackAddr(addr string) (string, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "", fmt.Errorf("invalid --addr %q: want host:port, such as 127.0.0.1:0", addr)
	}
	if host != "127.0.0.1" && !strings.EqualFold(host, "localhost") {
		return "", fmt.Errorf("--addr %q: ZweTag only listens on this computer; use 127.0.0.1 or localhost", addr)
	}
	if n, err := strconv.Atoi(port); err != nil || n < 0 || n > 65535 {
		return "", fmt.Errorf("invalid port in --addr %q", addr)
	}
	return net.JoinHostPort("127.0.0.1", port), nil
}

// projectPath returns the absolute path of the project file: the --file
// value, else zwetag.json next to the program, else, when that folder is not
// writable, ZweTag/zwetag.json in the user's configuration folder.
func projectPath(flagValue string) (string, error) {
	var p string
	if flagValue != "" {
		abs, err := filepath.Abs(flagValue)
		if err != nil {
			return "", fmt.Errorf("--file %q: %v", flagValue, err)
		}
		p = abs
	} else {
		p = defaultProjectPath()
		if p == "" {
			return "", errors.New("no folder to keep the project in; use --file")
		}
	}
	// Follow a link so saves replace the file it points to, not the link.
	if real, err := filepath.EvalSymlinks(p); err == nil {
		p = real
	}
	if info, err := os.Stat(p); err == nil && info.IsDir() {
		return "", fmt.Errorf("--file %q is a folder", p)
	}
	return p, nil
}

func defaultProjectPath() string {
	if exe, err := os.Executable(); err == nil {
		if real, err := filepath.EvalSymlinks(exe); err == nil {
			exe = real
		}
		dir := filepath.Dir(exe)
		if writable(dir) {
			return filepath.Join(dir, projectName)
		}
	}
	if config, err := os.UserConfigDir(); err == nil {
		return filepath.Join(config, "ZweTag", projectName)
	}
	return ""
}

// writable reports whether a file can be created in dir.
func writable(dir string) bool {
	f, err := os.CreateTemp(dir, ".zwetag-*.tmp")
	if err != nil {
		return false
	}
	name := f.Name()
	_ = f.Close()
	_ = os.Remove(name)
	return true
}

// openLog opens the log for appending, emptying it first when it has grown
// past maxLogBytes.
func openLog(p string) (*os.File, error) {
	flags := os.O_CREATE | os.O_WRONLY | os.O_APPEND
	if info, err := os.Stat(p); err == nil && info.Size() > maxLogBytes {
		flags |= os.O_TRUNC
	}
	return os.OpenFile(p, flags, 0o600)
}
