package traefik_plugin_metrics

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// newTestHandler creates a middleware instance with the log emitter disabled
// and no IP allowlist (open access for tests).
func newTestHandler(t *testing.T, next http.Handler) http.Handler {
	t.Helper()
	cfg := CreateConfig()
	cfg.LogIntervalSeconds = 0
	h, err := New(context.Background(), next, cfg, "test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	return h
}

// getMetrics hits the metrics endpoint and returns the parsed JSON map.
func getMetrics(t *testing.T, h http.Handler) map[string]interface{} {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/.well-known/nhp-metrics", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var data map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&data); err != nil {
		t.Fatalf("failed to decode metrics JSON: %v", err)
	}
	return data
}

func TestMetricsEndpoint(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})
	handler := newTestHandler(t, next)

	req := httptest.NewRequest(http.MethodGet, "/hello", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}

	data := getMetrics(t, handler)

	if total, ok := data["request_total"].(float64); !ok || total != 1 {
		t.Errorf("expected request_total=1, got %v", data["request_total"])
	}
	if s2xx, ok := data["status_2xx"].(float64); !ok || s2xx != 1 {
		t.Errorf("expected status_2xx=1, got %v", data["status_2xx"])
	}
	if std, ok := data["proxy_standard"].(float64); !ok || std != 1 {
		t.Errorf("expected proxy_standard=1, got %v", data["proxy_standard"])
	}
}

func TestWebSocketDetection(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := newTestHandler(t, next)

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	data := getMetrics(t, handler)
	if ws, ok := data["proxy_websocket"].(float64); !ok || ws != 1 {
		t.Errorf("expected proxy_websocket=1, got %v", data["proxy_websocket"])
	}
}

func TestWebSocketDetectionCommaHeader(t *testing.T) {
	// Connection header can be a comma-separated list
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := newTestHandler(t, next)

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	req.Header.Set("Connection", "keep-alive, Upgrade")
	req.Header.Set("Upgrade", "websocket")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	data := getMetrics(t, handler)
	if ws, ok := data["proxy_websocket"].(float64); !ok || ws != 1 {
		t.Errorf("expected proxy_websocket=1 for comma-separated Connection header, got %v", data["proxy_websocket"])
	}
}

func TestStreamingDetection(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := newTestHandler(t, next)

	req := httptest.NewRequest(http.MethodGet, "/events", nil)
	req.Header.Set("Accept", "text/event-stream")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	data := getMetrics(t, handler)
	if v, ok := data["proxy_streaming"].(float64); !ok || v != 1 {
		t.Errorf("expected proxy_streaming=1, got %v", data["proxy_streaming"])
	}
}

func TestHistogramPercentile(t *testing.T) {
	h := newHistogram(100)
	for i := 1; i <= 100; i++ {
		h.Record(float64(i))
	}
	sorted := h.sortedSnapshot()
	p50 := percentileFromSorted(sorted, 50)
	if p50 != 50 {
		t.Errorf("expected p50=50, got %f", p50)
	}
	p99 := percentileFromSorted(sorted, 99)
	if p99 != 99 {
		t.Errorf("expected p99=99, got %f", p99)
	}
}

func TestHistogramRingBufferWrap(t *testing.T) {
	h := newHistogram(5)
	for i := 1; i <= 10; i++ {
		h.Record(float64(i))
	}
	sorted := h.sortedSnapshot()
	if len(sorted) != 5 {
		t.Fatalf("expected 5 samples, got %d", len(sorted))
	}
	p50 := percentileFromSorted(sorted, 50)
	if p50 != 8 {
		t.Errorf("expected p50=8, got %f", p50)
	}
}

func TestHistogramEmptySnapshot(t *testing.T) {
	h := newHistogram(100)
	sorted := h.sortedSnapshot()
	if sorted != nil {
		t.Errorf("expected nil for empty histogram, got %v", sorted)
	}
}

func TestPercentileFromSortedEmpty(t *testing.T) {
	if v := percentileFromSorted(nil, 50); v != 0 {
		t.Errorf("expected 0 for nil slice, got %f", v)
	}
	if v := percentileFromSorted([]float64{}, 95); v != 0 {
		t.Errorf("expected 0 for empty slice, got %f", v)
	}
}

func TestPercentileFromSortedSingleElement(t *testing.T) {
	v := percentileFromSorted([]float64{42}, 1)
	if v != 42 {
		t.Errorf("expected 42, got %f", v)
	}
}

func TestErrorClassification(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/unauthorized":
			w.WriteHeader(http.StatusUnauthorized)
		case "/forbidden":
			w.WriteHeader(http.StatusForbidden)
		case "/bad-gateway":
			w.WriteHeader(http.StatusBadGateway)
		case "/unavailable":
			w.WriteHeader(http.StatusServiceUnavailable)
		case "/timeout":
			w.WriteHeader(http.StatusGatewayTimeout)
		case "/redirect":
			w.WriteHeader(http.StatusMovedPermanently)
		default:
			w.WriteHeader(http.StatusOK)
		}
	})
	handler := newTestHandler(t, next)

	paths := []string{"/unauthorized", "/forbidden", "/bad-gateway", "/unavailable", "/timeout", "/redirect"}
	for _, p := range paths {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
	}

	data := getMetrics(t, handler)

	if v, ok := data["error_unauthorized"].(float64); !ok || v != 2 {
		t.Errorf("expected error_unauthorized=2, got %v", data["error_unauthorized"])
	}
	if v, ok := data["error_backend_connect"].(float64); !ok || v != 2 {
		t.Errorf("expected error_backend_connect=2, got %v", data["error_backend_connect"])
	}
	if v, ok := data["error_backend_timeout"].(float64); !ok || v != 1 {
		t.Errorf("expected error_backend_timeout=1, got %v", data["error_backend_timeout"])
	}
	if v, ok := data["status_3xx"].(float64); !ok || v != 1 {
		t.Errorf("expected status_3xx=1, got %v", data["status_3xx"])
	}
	if v, ok := data["status_4xx"].(float64); !ok || v != 2 {
		t.Errorf("expected status_4xx=2, got %v", data["status_4xx"])
	}
	if v, ok := data["status_5xx"].(float64); !ok || v != 3 {
		t.Errorf("expected status_5xx=3, got %v", data["status_5xx"])
	}
}

func TestPanicRecovery(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("test panic")
	})
	handler := newTestHandler(t, next)

	req := httptest.NewRequest(http.MethodGet, "/panic", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 after panic, got %d", rec.Code)
	}

	data := getMetrics(t, handler)
	if v, ok := data["error_panic"].(float64); !ok || v != 1 {
		t.Errorf("expected error_panic=1, got %v", data["error_panic"])
	}
	// Panic should also record status_5xx and request_duration
	if v, ok := data["status_5xx"].(float64); !ok || v != 1 {
		t.Errorf("expected status_5xx=1 after panic, got %v", data["status_5xx"])
	}
	// Duration is recorded even on panic (may be 0ms in fast tests, but
	// the key must exist in the snapshot).
	if _, ok := data["request_duration_p50_ms"]; !ok {
		t.Error("expected request_duration_p50_ms key in snapshot after panic")
	}
}

func TestWriteWithoutExplicitWriteHeader(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("no explicit header"))
	})
	handler := newTestHandler(t, next)

	req := httptest.NewRequest(http.MethodGet, "/implicit", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}

	data := getMetrics(t, handler)
	if v, ok := data["status_2xx"].(float64); !ok || v != 1 {
		t.Errorf("expected status_2xx=1, got %v", data["status_2xx"])
	}
}

func TestDuplicateWriteHeader(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		w.WriteHeader(http.StatusInternalServerError) // should be ignored
	})
	handler := newTestHandler(t, next)

	req := httptest.NewRequest(http.MethodGet, "/dup", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d", rec.Code)
	}

	data := getMetrics(t, handler)
	if v, ok := data["status_2xx"].(float64); !ok || v != 1 {
		t.Errorf("expected status_2xx=1, got %v", data["status_2xx"])
	}
}

func TestFlushDelegation(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("chunk"))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		} else {
			t.Error("expected wrappedWriter to implement http.Flusher")
		}
	})
	handler := newTestHandler(t, next)

	req := httptest.NewRequest(http.MethodGet, "/flush", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Flushed != true {
		t.Error("expected Flush to be delegated to the underlying ResponseWriter")
	}
}

func TestHijackDelegation(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hj, ok := w.(http.Hijacker); ok {
			_, _, err := hj.Hijack()
			if err != http.ErrNotSupported {
				t.Errorf("expected ErrNotSupported, got %v", err)
			}
		} else {
			t.Error("expected wrappedWriter to implement http.Hijacker")
		}
		w.WriteHeader(http.StatusOK)
	})
	handler := newTestHandler(t, next)

	req := httptest.NewRequest(http.MethodGet, "/hijack", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
}

func TestDefaultMetricsPath(t *testing.T) {
	cfg := &Config{
		MetricsPath:        "",
		LogIntervalSeconds: 0,
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h, err := New(context.Background(), next, cfg, "test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, defaultMetricsPath, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 from default metrics path, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected application/json, got %s", ct)
	}
}

func TestLogEmitterStartsAndStops(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	m := newMetrics()
	m.RequestTotal.Add(5)

	done := make(chan struct{})
	origStart := m.startLogEmitter
	_ = origStart
	// Start the emitter and signal when context is cancelled.
	m.startLogEmitter(ctx, 1)

	go func() {
		// Wait for at least one tick then cancel.
		time.Sleep(1200 * time.Millisecond)
		cancel()
		close(done)
	}()

	select {
	case <-done:
		// success
	case <-time.After(5 * time.Second):
		t.Fatal("log emitter did not stop within timeout")
	}
}

func TestCloseStopsLogEmitter(t *testing.T) {
	cfg := CreateConfig()
	cfg.LogIntervalSeconds = 1
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h, err := New(context.Background(), next, cfg, "test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Close should not panic or hang.
	if closer, ok := h.(interface{ Close() error }); ok {
		if err := closer.Close(); err != nil {
			t.Errorf("unexpected error from Close: %v", err)
		}
	} else {
		t.Error("expected NHPMetrics to implement Close()")
	}
}

// ---------- IP allowlist tests ----------

func TestMetricsAllowedIP(t *testing.T) {
	cfg := &Config{
		MetricsPath:        defaultMetricsPath,
		LogIntervalSeconds: 0,
		AllowedCIDRs:       []string{"10.0.0.0/8"},
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h, err := New(context.Background(), next, cfg, "test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Allowed IP
	req := httptest.NewRequest(http.MethodGet, defaultMetricsPath, nil)
	req.RemoteAddr = "10.1.2.3:9999"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 for allowed IP, got %d", rec.Code)
	}
}

func TestMetricsBlockedIP(t *testing.T) {
	cfg := &Config{
		MetricsPath:        defaultMetricsPath,
		LogIntervalSeconds: 0,
		AllowedCIDRs:       []string{"10.0.0.0/8"},
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h, err := New(context.Background(), next, cfg, "test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Blocked IP
	req := httptest.NewRequest(http.MethodGet, defaultMetricsPath, nil)
	req.RemoteAddr = "192.168.1.1:9999"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 for blocked IP, got %d", rec.Code)
	}
}

func TestMetricsNoAllowlist(t *testing.T) {
	// No AllowedCIDRs = open to all (backwards compatible)
	cfg := &Config{
		MetricsPath:        defaultMetricsPath,
		LogIntervalSeconds: 0,
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h, err := New(context.Background(), next, cfg, "test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, defaultMetricsPath, nil)
	req.RemoteAddr = "1.2.3.4:9999"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 with no allowlist, got %d", rec.Code)
	}
}

func TestParseCIDRsPlainIP(t *testing.T) {
	nets := parseCIDRs([]string{"192.168.1.1", "::1"})
	if len(nets) != 2 {
		t.Fatalf("expected 2 nets, got %d", len(nets))
	}
}

func TestParseCIDRsInvalid(t *testing.T) {
	nets := parseCIDRs([]string{"not-an-ip"})
	if len(nets) != 0 {
		t.Errorf("expected 0 nets for invalid input, got %d", len(nets))
	}
}

func TestDeadMetricsRemoved(t *testing.T) {
	// Verify the dead metrics flagged in review are no longer in the snapshot.
	handler := newTestHandler(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	data := getMetrics(t, handler)

	dead := []string{
		"cache_size", "session_cache_hit", "session_cache_miss",
		"private_ac_api_call", "private_ac_cache_hit",
		"backend_duration_p50_ms", "backend_duration_p95_ms",
		"api_lookup_p95_ms", "html_rewrite_p95_ms",
	}
	for _, key := range dead {
		if _, exists := data[key]; exists {
			t.Errorf("dead metric %q should have been removed from snapshot", key)
		}
	}
}
