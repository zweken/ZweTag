//go:build windows

package main

import (
	"errors"
	"log"
	"os/exec"
	"runtime"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/webviewloader"
	"golang.org/x/sys/windows"
)

// The window has no system frame. The top bar of the interface is its caption: it draws its own
// minimize, maximize and close buttons and asks the window, through the functions bound below
// (zwetagWindow and the others), to move, resize, minimize, maximize or close. In a browser those
// functions do not exist, so the page shows no window buttons there.
//
// The frame goes away the way well-behaved frameless windows do it: the window keeps its normal
// styles (so snapping, the minimize and maximize animations, Alt+Space and Alt+F4 keep working)
// and answers WM_NCCALCSIZE with a client area that covers the whole window. DWM still draws the
// shadow, and rounded corners on Windows 11.

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	dwmapi   = windows.NewLazySystemDLL("dwmapi.dll")
	pSetDPIC = user32.NewProc("SetProcessDpiAwarenessContext")
	pSetDPIA = user32.NewProc("SetProcessDPIAware")
	pDPISys  = user32.NewProc("GetDpiForSystem")
	pSetWLP  = user32.NewProc("SetWindowLongPtrW")
	pCallWP  = user32.NewProc("CallWindowProcW")
	pDefWP   = user32.NewProc("DefWindowProcW")
	pSetPos  = user32.NewProc("SetWindowPos")
	pShow    = user32.NewProc("ShowWindow")
	pZoomed  = user32.NewProc("IsZoomed")
	pRelCap  = user32.NewProc("ReleaseCapture")
	pSend    = user32.NewProc("SendMessageW")
	pPost    = user32.NewProc("PostMessageW")
	pMonFrom = user32.NewProc("MonitorFromWindow")
	pMonInfo = user32.NewProc("GetMonitorInfoW")
	pExtend  = dwmapi.NewProc("DwmExtendFrameIntoClientArea")
	pDwmAttr = dwmapi.NewProc("DwmSetWindowAttribute")
)

const (
	gwlpWndProc = -4

	wmClose         = 0x0010
	wmNCCalcSize    = 0x0083
	wmNCActivate    = 0x0086
	wmNCLButtonDown = 0x00A1
	wmDPIChanged    = 0x02E0
	htCaption       = 2

	swMaximize = 3
	swMinimize = 6
	swRestore  = 9

	swpNoSize       = 0x0001
	swpNoMove       = 0x0002
	swpNoZOrder     = 0x0004
	swpNoActivate   = 0x0010
	swpFrameChanged = 0x0020

	monitorDefaultToNearest     = 2
	dwmwaWindowCornerPreference = 33
	dwmwcpRound                 = 2

	windowWidth  = 1280
	windowHeight = 860
)

// dpiPerMonitorV2 is DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, the handle value -4.
var dpiPerMonitorV2 = ^uintptr(3)

type rect struct{ Left, Top, Right, Bottom int32 }

type monitorInfo struct {
	Size  uint32
	Full  rect
	Work  rect
	Flags uint32
}

type margins struct{ Left, Right, Top, Bottom int32 }

type ncCalcSizeParams struct {
	Rects [3]rect
	Pos   uintptr
}

// windowState is what zwetagWindow returns to the page.
type windowState struct {
	Maximized bool `json:"maximized"`
}

// frame is the window being shown; the message hook below needs its previous window procedure.
var frame struct {
	hwnd     uintptr
	previous uintptr
}

// openWindow shows the interface in a WebView2 window and blocks until the
// window is closed; it then returns true. It must be called from the main
// goroutine: the WebView2 package locks that goroutine to the main thread
// and prepares COM there. Without the WebView2 runtime it returns false at
// once, and the caller opens the default browser instead.
func openWindow(url string) (shown bool) {
	// The package ends the process when the runtime fails to start, so it
	// is only used when a runtime is installed.
	if v, err := webviewloader.GetInstalledVersion(); err != nil || v == "" {
		log.Print("WebView2 runtime not found; using the default browser")
		return false
	}
	runtime.LockOSThread()
	defer func() {
		if r := recover(); r != nil {
			log.Printf("WebView2 window failed (%v); using the default browser", r)
			shown = false
		}
	}()
	// Sharp text on scaled displays: the window measures in device pixels and WebView2 follows
	// each monitor's scale. Older Windows get system DPI awareness instead.
	if pSetDPIC.Find() == nil {
		pSetDPIC.Call(dpiPerMonitorV2)
	} else if pSetDPIA.Find() == nil {
		pSetDPIA.Call()
	}
	dpi := uint32(96)
	if pDPISys.Find() == nil {
		if d, _, _ := pDPISys.Call(); d != 0 {
			dpi = uint32(d)
		}
	}
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  "ZweTag",
			Width:  uint(scaleToDPI(windowWidth, dpi)),
			Height: uint(scaleToDPI(windowHeight, dpi)),
			// The icon group embedded from the .syso resource file.
			IconId: 1,
			Center: true,
		},
	})
	if w == nil {
		log.Print("WebView2 window could not be created; using the default browser")
		return false
	}
	defer w.Destroy()
	hwnd := uintptr(w.Window())
	makeFrameless(hwnd)
	bindWindowControls(w, hwnd)
	w.Navigate(url)
	w.Run()
	return true
}

// makeFrameless hooks the window procedure and makes Windows recalculate the frame.
func makeFrameless(hwnd uintptr) {
	frame.hwnd = hwnd
	idx := gwlpWndProc // a variable: a negative constant cannot be converted to uintptr
	frame.previous, _, _ = pSetWLP.Call(hwnd, uintptr(idx), syscall.NewCallback(frameProc))
	m := margins{1, 1, 1, 1}
	pExtend.Call(hwnd, uintptr(unsafe.Pointer(&m)))
	corner := uint32(dwmwcpRound)
	pDwmAttr.Call(hwnd, dwmwaWindowCornerPreference, uintptr(unsafe.Pointer(&corner)), 4)
	pSetPos.Call(hwnd, 0, 0, 0, 0, 0, swpFrameChanged|swpNoMove|swpNoSize|swpNoZOrder|swpNoActivate)
}

// frameProc removes the system frame and caption; every other message goes to the window
// procedure of the WebView2 package.
func frameProc(hwnd, msg, wparam, lparam uintptr) uintptr {
	switch msg {
	case wmNCCalcSize:
		if wparam != 0 {
			// A maximized window hangs its frame over the screen edges; keep the content on the
			// work area of its monitor instead.
			if maximized(hwnd) {
				if work, ok := workArea(hwnd); ok {
					(*ncCalcSizeParams)(osPointer(lparam)).Rects[0] = work
				}
			}
			return 0
		}
	case wmNCActivate:
		// Activation changes would repaint the caption that is no longer there.
		r, _, _ := pDefWP.Call(hwnd, msg, wparam, ^uintptr(0))
		return r
	case wmDPIChanged:
		// Moved to a monitor with another scale: take the size Windows suggests.
		r := (*rect)(osPointer(lparam))
		pSetPos.Call(hwnd, 0, uintptr(r.Left), uintptr(r.Top),
			uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top), swpNoZOrder|swpNoActivate)
		return 0
	}
	r, _, _ := pCallWP.Call(frame.previous, hwnd, msg, wparam, lparam)
	return r
}

// osPointer turns a message parameter that Windows filled with an address of its own memory into
// a pointer; the memory is not managed by Go, so the garbage collector does not need to track it.
func osPointer(addr uintptr) unsafe.Pointer {
	return *(*unsafe.Pointer)(unsafe.Pointer(&addr))
}

func maximized(hwnd uintptr) bool {
	z, _, _ := pZoomed.Call(hwnd)
	return z != 0
}

func workArea(hwnd uintptr) (rect, bool) {
	mon, _, _ := pMonFrom.Call(hwnd, monitorDefaultToNearest)
	if mon == 0 {
		return rect{}, false
	}
	mi := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	ok, _, _ := pMonInfo.Call(mon, uintptr(unsafe.Pointer(&mi)))
	return mi.Work, ok != 0
}

// startNonClient starts the native move or resize loop as if the mouse went down on the given
// part of a system frame. The bound functions run on the window's thread, so the capture the
// page holds can be released here.
func startNonClient(hwnd, hit uintptr) {
	pRelCap.Call()
	pSend.Call(hwnd, wmNCLButtonDown, hit, 0)
}

// bindWindowControls gives the page its window buttons: zwetagWindow (the state; its presence
// tells the page that it runs in this window), zwetagMinimize, zwetagMaximize (toggles and
// returns the new state), zwetagClose, zwetagDrag (move by the top bar) and zwetagResize (resize
// from an edge or corner, see resizeEdges).
func bindWindowControls(w webview2.WebView, hwnd uintptr) {
	must := func(err error) {
		if err != nil {
			log.Printf("window control binding: %v", err)
		}
	}
	must(w.Bind("zwetagWindow", func() windowState { return windowState{Maximized: maximized(hwnd)} }))
	must(w.Bind("zwetagMinimize", func() { pShow.Call(hwnd, swMinimize) }))
	must(w.Bind("zwetagMaximize", func() windowState {
		if maximized(hwnd) {
			pShow.Call(hwnd, swRestore)
		} else {
			pShow.Call(hwnd, swMaximize)
		}
		return windowState{Maximized: maximized(hwnd)}
	}))
	must(w.Bind("zwetagClose", func() { pPost.Call(hwnd, wmClose, 0, 0) }))
	must(w.Bind("zwetagDrag", func() { startNonClient(hwnd, htCaption) }))
	must(w.Bind("zwetagResize", func(edge string) error {
		hit, ok := resizeHit(edge)
		if !ok {
			return errors.New("unknown window edge")
		}
		startNonClient(hwnd, hit)
		return nil
	}))
}

// revealFile opens File Explorer with path selected. The command line is
// written by hand: Explorer does not understand the quoting Go would apply
// to "/select,<path>" when the path contains a space.
func revealFile(path string) error {
	cmd := exec.Command("explorer.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `explorer.exe /select,"` + path + `"`}
	return startDetached(cmd)
}
