package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// pingInterval is how often an open event stream receives a keep-alive
// comment.
const pingInterval = 15 * time.Second

// alive counts the pages that hold GET /api/alive open. When the browser is
// the only window, the process ends a grace period after the last page has
// gone; a page that reconnects within that time (a reload) cancels it.
type alive struct {
	mu      sync.Mutex
	open    int           // streams currently connected
	seen    bool          // a page has connected at least once
	grace   time.Duration // delay before onIdle runs
	onIdle  func()        // nil until enable; then called at most once
	gen     uint64        // bumped by every connection and every timer
	timer   *time.Timer
	done    bool // onIdle has run, or the server is shutting down
	pingGap time.Duration
}

func newAlive() *alive {
	return &alive{pingGap: pingInterval}
}

// enable turns on the exit after the last page has gone.
func (a *alive) enable(grace time.Duration, onIdle func()) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.grace, a.onIdle = grace, onIdle
	if a.seen && a.open == 0 {
		a.scheduleLocked()
	}
}

// stop cancels any pending exit; used by Shutdown.
func (a *alive) stop() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.done = true
	a.gen++
	if a.timer != nil {
		a.timer.Stop()
		a.timer = nil
	}
}

func (a *alive) connect() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.open++
	a.seen = true
	a.gen++
	if a.timer != nil {
		a.timer.Stop()
		a.timer = nil
	}
}

func (a *alive) disconnect() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.open--
	if a.open == 0 && a.onIdle != nil {
		a.scheduleLocked()
	}
}

// scheduleLocked starts the grace timer. The callback re-checks the state
// under the lock, so a connection that raced with the timer always wins.
func (a *alive) scheduleLocked() {
	if a.done {
		return
	}
	a.gen++
	gen := a.gen
	a.timer = time.AfterFunc(a.grace, func() {
		a.mu.Lock()
		if gen != a.gen || a.open != 0 || a.done {
			a.mu.Unlock()
			return
		}
		a.done = true
		onIdle := a.onIdle
		a.mu.Unlock()
		onIdle()
	})
}

// handleAlive holds a Server-Sent Events stream open for as long as the page
// lives. It sends one message when the stream opens and a comment line as a
// keep-alive every pingInterval.
func (s *Server) handleAlive(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "Streaming is not supported.")
		return
	}
	hello, _ := json.Marshal(map[string]string{"app": "ZweTag", "version": s.cfg.Version})

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)

	s.alive.connect()
	defer s.alive.disconnect()

	// retry: a dropped stream reconnects after one second, well inside the
	// grace period.
	if _, err := fmt.Fprintf(w, "retry: 1000\ndata: %s\n\n", hello); err != nil {
		return
	}
	flusher.Flush()

	ticker := time.NewTicker(s.alive.pingGap)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-s.done:
			return
		case <-ticker.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
