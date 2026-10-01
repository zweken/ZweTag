package app

import (
	"bufio"
	"context"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// liveServer is a server on a real loopback listener, for the event stream.
func liveServer(t *testing.T, setup func(*Server)) (*Server, string) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv, err := New(Config{
		File:    filepath.Join(t.TempDir(), "zwetag.json"),
		Version: "1.2.3",
		Addr:    ln.Addr().String(),
		Assets:  testAssets,
	})
	if err != nil {
		t.Fatal(err)
	}
	if setup != nil {
		setup(srv)
	}
	served := make(chan error, 1)
	go func() { served <- srv.Serve(ln) }()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			t.Errorf("shutdown: %v", err)
		}
		if err := <-served; err != nil {
			t.Errorf("serve: %v", err)
		}
	})
	return srv, "http://" + ln.Addr().String()
}

// stream is one page holding GET /api/alive open.
type stream struct {
	resp   *http.Response
	reader *bufio.Reader
}

// openStream connects like the page's EventSource does: no X-ZweTag header.
func openStream(t *testing.T, base string) *stream {
	t.Helper()
	req, err := http.NewRequest("GET", base+"/api/alive", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Accept", "text/event-stream")
	client := &http.Client{Transport: &http.Transport{DisableKeepAlives: true}}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "text/event-stream" {
		resp.Body.Close()
		t.Fatalf("GET /api/alive: %d %q", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	s := &stream{resp: resp, reader: bufio.NewReader(resp.Body)}
	if ev := s.next(t); !strings.Contains(ev, "retry: 1000\n") || !strings.Contains(ev, `data: {"app":"ZweTag","version":"1.2.3"}`) {
		t.Fatalf("first event %q", ev)
	}
	return s
}

// next reads up to the end of the next event or comment block.
func (s *stream) next(t *testing.T) string {
	t.Helper()
	type result struct {
		text string
		err  error
	}
	got := make(chan result, 1)
	go func() {
		var b strings.Builder
		for {
			line, err := s.reader.ReadString('\n')
			b.WriteString(line)
			if err != nil {
				got <- result{b.String(), err}
				return
			}
			if line == "\n" {
				got <- result{b.String(), nil}
				return
			}
		}
	}()
	select {
	case r := <-got:
		if r.err != nil {
			t.Fatalf("stream ended: %v (read %q)", r.err, r.text)
		}
		return r.text
	case <-time.After(5 * time.Second):
		t.Fatal("no event within 5s")
		return ""
	}
}

func (s *stream) close() { s.resp.Body.Close() }

// exitProbe records when the server asked to exit.
type exitProbe struct{ at chan time.Time }

func newExitProbe() *exitProbe { return &exitProbe{at: make(chan time.Time, 2)} }

func (p *exitProbe) onIdle() { p.at <- time.Now() }

func (p *exitProbe) wait(t *testing.T, within time.Duration) time.Time {
	t.Helper()
	select {
	case at := <-p.at:
		return at
	case <-time.After(within):
		t.Fatalf("no exit within %v", within)
		return time.Time{}
	}
}

func (p *exitProbe) none(t *testing.T, during time.Duration) {
	t.Helper()
	select {
	case <-p.at:
		t.Fatal("exited while a page was connected or before any page connected")
	case <-time.After(during):
	}
}

func TestAliveStreamNeedsNoHeader(t *testing.T) {
	_, base := liveServer(t, nil)
	s := openStream(t, base)
	defer s.close()
	h := s.resp.Header
	if h.Get("Cache-Control") != "no-store" || h.Get("Content-Security-Policy") != ContentSecurityPolicy {
		t.Fatalf("headers %v", h)
	}
}

func TestAliveSendsPings(t *testing.T) {
	_, base := liveServer(t, func(s *Server) { s.alive.pingGap = 20 * time.Millisecond })
	s := openStream(t, base)
	defer s.close()
	if ev := s.next(t); ev != ": ping\n\n" {
		t.Fatalf("ping %q", ev)
	}
}

func TestAliveExitsAfterTheLastPageCloses(t *testing.T) {
	const grace = 200 * time.Millisecond
	probe := newExitProbe()
	_, base := liveServer(t, func(s *Server) { s.ExitWhenIdle(grace, probe.onIdle) })

	a := openStream(t, base)
	b := openStream(t, base)
	a.close()
	probe.none(t, 3*grace)

	closed := time.Now()
	b.close()
	at := probe.wait(t, 5*time.Second)
	if waited := at.Sub(closed); waited < grace {
		t.Fatalf("exited %v after the last page closed, before the %v grace period", waited, grace)
	}
	probe.none(t, 3*grace) // once only
}

func TestAliveReloadCancelsTheExit(t *testing.T) {
	// Wide enough for a slow machine under the race detector to reconnect
	// well inside it.
	const grace = 800 * time.Millisecond
	probe := newExitProbe()
	_, base := liveServer(t, func(s *Server) { s.ExitWhenIdle(grace, probe.onIdle) })

	first := openStream(t, base)
	first.close()
	time.Sleep(grace / 8)
	second := openStream(t, base) // the reloaded page
	probe.none(t, 3*grace)

	second.close()
	probe.wait(t, 5*time.Second)
}

func TestAliveNoExitBeforeAnyPage(t *testing.T) {
	probe := newExitProbe()
	liveServer(t, func(s *Server) { s.ExitWhenIdle(20*time.Millisecond, probe.onIdle) })
	probe.none(t, 300*time.Millisecond)
}

func TestAliveNoExitUnlessEnabled(t *testing.T) {
	// --server and window mode never call ExitWhenIdle.
	srv, base := liveServer(t, nil)
	s := openStream(t, base)
	s.close()
	time.Sleep(100 * time.Millisecond)
	srv.alive.mu.Lock()
	timer := srv.alive.timer
	srv.alive.mu.Unlock()
	if timer != nil {
		t.Fatal("an exit was scheduled although it was never enabled")
	}
}

func TestShutdownEndsOpenStreams(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv, err := New(Config{File: filepath.Join(t.TempDir(), "zwetag.json"), Addr: ln.Addr().String(), Assets: testAssets, Version: "1.2.3"})
	if err != nil {
		t.Fatal(err)
	}
	served := make(chan error, 1)
	go func() { served <- srv.Serve(ln) }()
	s := openStream(t, "http://"+ln.Addr().String())
	defer s.close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	start := time.Now()
	if err := srv.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown: %v", err)
	}
	if err := <-served; err != nil {
		t.Fatalf("serve: %v", err)
	}
	if d := time.Since(start); d > time.Second {
		t.Fatalf("shutdown took %v", d)
	}
	if _, err := io.ReadAll(s.reader); err != nil {
		t.Fatalf("stream did not end cleanly: %v", err)
	}
}
