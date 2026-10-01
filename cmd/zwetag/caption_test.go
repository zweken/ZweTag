package main

import "testing"

func TestResizeHit(t *testing.T) {
	want := map[string]uintptr{
		"left": 10, "right": 11, "top": 12, "top-left": 13,
		"top-right": 14, "bottom": 15, "bottom-left": 16, "bottom-right": 17,
	}
	for edge, code := range want {
		if got, ok := resizeHit(edge); !ok || got != code {
			t.Errorf("resizeHit(%q) = %d, %v; want %d", edge, got, ok, code)
		}
	}
	for _, edge := range []string{"", "caption", "Left", "middle"} {
		if _, ok := resizeHit(edge); ok {
			t.Errorf("resizeHit(%q) accepted an unknown edge", edge)
		}
	}
	if len(resizeEdges) != len(want) {
		t.Errorf("%d edges, want %d", len(resizeEdges), len(want))
	}
}

func TestScaleToDPI(t *testing.T) {
	cases := []struct {
		size int
		dpi  uint32
		want int
	}{
		{1280, 96, 1280}, {1280, 144, 1920}, {860, 120, 1075}, {860, 0, 860}, {1280, 192, 2560},
	}
	for _, c := range cases {
		if got := scaleToDPI(c.size, c.dpi); got != c.want {
			t.Errorf("scaleToDPI(%d, %d) = %d, want %d", c.size, c.dpi, got, c.want)
		}
	}
}
