package traefik_plugin_metrics

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMetricsEndpoint(t *testing.T) {
	cfg := CreateConfig()
	cfg.LogIntervalSeconds = 0 // disable log ticker in tests

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	handler, err := New(context.Background(), next, cfg, "test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Send a normal request first to increment counters.
	req := httptest.NewRequest(http.MethodGet, "/hello", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}

	// Now hit the metrics endpoint.
	req = httptest.NewRequest(http.MethodGet, "/.well-known/nhp-metrics", nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 from metrics, got %d", rec.Code)
	}

	var data map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&data); err != nil {
		t.Fatalf("failed to decode metrics JSON: %v", err)
	}

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
	cfg := CreateConfig()
	cfg.LogIntervalSeconds = 0

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler, err := New(context.Background(), next, cfg, "test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	// Check metrics
	metricsReq := httptest.NewRequest(http.MethodGet, "/.well-known/nhp-metrics", nil)
	metricsRec := httptest.NewRecorder()
	handler.ServeHTTP(metricsRec, metricsReq)

	var data map[string]interface{}
	json.NewDecoder(metricsRec.Body).Decode(&data)

	if ws, ok := data["proxy_websocket"].(float64); !ok || ws != 1 {
		t.Errorf("expected proxy_websocket=1, got %v", data["proxy_websocket"])
	}
}

func TestHistogramPercentile(t *testing.T) {
	h := newHistogram(100)
	for i := 1; i <= 100; i++ {
		h.Record(float64(i))
	}
	p50 := h.Percentile(50)
	if p50 != 50 {
		t.Errorf("expected p50=50, got %f", p50)
	}
	p99 := h.Percentile(99)
	if p99 != 99 {
		t.Errorf("expected p99=99, got %f", p99)
	}
}

func TestErrorClassification(t *testing.T) {
	cfg := CreateConfig()
	cfg.LogIntervalSeconds = 0

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/unauthorized":
			w.WriteHeader(http.StatusUnauthorized)
		case "/bad-gateway":
			w.WriteHeader(http.StatusBadGateway)
		case "/timeout":
			w.WriteHeader(http.StatusGatewayTimeout)
		default:
			w.WriteHeader(http.StatusOK)
		}
	})

	handler, err := New(context.Background(), next, cfg, "test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	paths := []string{"/unauthorized", "/bad-gateway", "/timeout"}
	for _, p := range paths {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
	}

	metricsReq := httptest.NewRequest(http.MethodGet, "/.well-known/nhp-metrics", nil)
	metricsRec := httptest.NewRecorder()
	handler.ServeHTTP(metricsRec, metricsReq)

	var data map[string]interface{}
	json.NewDecoder(metricsRec.Body).Decode(&data)

	if v, ok := data["error_unauthorized"].(float64); !ok || v != 1 {
		t.Errorf("expected error_unauthorized=1, got %v", data["error_unauthorized"])
	}
	if v, ok := data["error_backend_connect"].(float64); !ok || v != 1 {
		t.Errorf("expected error_backend_connect=1, got %v", data["error_backend_connect"])
	}
	if v, ok := data["error_backend_timeout"].(float64); !ok || v != 1 {
		t.Errorf("expected error_backend_timeout=1, got %v", data["error_backend_timeout"])
	}
}
