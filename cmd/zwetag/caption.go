package main

// Hit-test codes (as WM_NCHITTEST returns them) of the edges and corners a frameless window is
// resized by. The interface draws thin handles along the window border and, when one is dragged,
// asks the window to start a native resize from that edge.
var resizeEdges = map[string]uintptr{
	"left":         10, // HTLEFT
	"right":        11, // HTRIGHT
	"top":          12, // HTTOP
	"top-left":     13, // HTTOPLEFT
	"top-right":    14, // HTTOPRIGHT
	"bottom":       15, // HTBOTTOM
	"bottom-left":  16, // HTBOTTOMLEFT
	"bottom-right": 17, // HTBOTTOMRIGHT
}

// resizeHit returns the hit-test code of an edge name used by the interface.
func resizeHit(edge string) (uintptr, bool) {
	hit, ok := resizeEdges[edge]
	return hit, ok
}

// scaleToDPI converts a size in 96-DPI pixels to device pixels.
func scaleToDPI(size int, dpi uint32) int {
	if dpi == 0 {
		return size
	}
	return (size*int(dpi) + 48) / 96
}
