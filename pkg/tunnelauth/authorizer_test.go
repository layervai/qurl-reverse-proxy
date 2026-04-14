package tunnelauth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/layervai/qurl-reverse-proxy/pkg/apiclient"
)

// mockAPI creates a test HTTP server that serves resource responses.
// handler is called for each request; the caller controls the response.
func mockAPI(t *testing.T, handler http.HandlerFunc) (*httptest.Server, *apiclient.Client) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	client := apiclient.New(srv.URL, "test-token", apiclient.WithMaxRetries(0))
	return srv, client
}

func activeResource(id, connectorID string) apiclient.Resource {
	return apiclient.Resource{
		ID:          id,
		Name:        "test",
		Status:      "active",
		ConnectorID: connectorID,
	}
}

func TestAuthorizer_CacheMissCallsAPI(t *testing.T) {
	var calls atomic.Int64
	_, client := mockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		json.NewEncoder(w).Encode(activeResource("r_abc", "conn_1"))
	})

	auth := New(client, WithCacheTTL(time.Minute))
	defer auth.Close()

	err := auth.AuthorizeTunnel(context.Background(), "r_abc", "conn_1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected 1 API call, got %d", calls.Load())
	}
}

func TestAuthorizer_CacheHitSkipsAPI(t *testing.T) {
	var calls atomic.Int64
	_, client := mockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		json.NewEncoder(w).Encode(activeResource("r_abc", "conn_1"))
	})

	auth := New(client, WithCacheTTL(time.Minute))
	defer auth.Close()

	// First call populates cache.
	if err := auth.AuthorizeTunnel(context.Background(), "r_abc", "conn_1"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Second call should hit cache.
	if err := auth.AuthorizeTunnel(context.Background(), "r_abc", "conn_1"); err != nil {
		t.Fatalf("unexpected error on cached call: %v", err)
	}

	if calls.Load() != 1 {
		t.Fatalf("expected 1 API call (cache hit), got %d", calls.Load())
	}
}

func TestAuthorizer_NotFoundRejectsKeepsCircuitClosed(t *testing.T) {
	_, client := mockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]any{
			"status_code": 404,
			"code":        "not_found",
			"message":     "resource not found",
		})
	})

	auth := New(client,
		WithCBFailureThreshold(1), // low threshold to verify 404 doesn't trip
	)
	defer auth.Close()

	// Multiple 404s should not trip the circuit breaker.
	for range 5 {
		err := auth.AuthorizeTunnel(context.Background(), "r_missing", "")
		if err != ErrResourceNotFound {
			t.Fatalf("expected ErrResourceNotFound, got %v", err)
		}
	}

	if auth.cb.State() != StateClosed {
		t.Fatalf("expected circuit to stay closed on 404s, got %v", auth.cb.State())
	}
}

func TestAuthorizer_CircuitBreakerTrips(t *testing.T) {
	_, client := mockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{
			"status_code": 500,
			"code":        "internal_error",
			"message":     "boom",
		})
	})

	auth := New(client,
		WithCBFailureThreshold(2),
		WithCBOpenDuration(time.Minute),
	)
	defer auth.Close()

	// Two 500s should trip the breaker.
	for range 2 {
		auth.AuthorizeTunnel(context.Background(), "r_abc", "")
	}

	if auth.cb.State() != StateOpen {
		t.Fatalf("expected circuit to be open, got %v", auth.cb.State())
	}

	// Next call should fail with ErrCircuitOpen.
	err := auth.AuthorizeTunnel(context.Background(), "r_abc", "")
	if err != ErrCircuitOpen {
		t.Fatalf("expected ErrCircuitOpen, got %v", err)
	}
}

func TestAuthorizer_CircuitBreakerRecovers(t *testing.T) {
	var shouldFail atomic.Bool
	shouldFail.Store(true)

	_, client := mockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		if shouldFail.Load() {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]any{"status_code": 500})
			return
		}
		json.NewEncoder(w).Encode(activeResource("r_abc", "conn_1"))
	})

	auth := New(client,
		WithCBFailureThreshold(1),
		WithCBSuccessThreshold(1),
		WithCBOpenDuration(50*time.Millisecond),
	)
	defer auth.Close()

	// Trip the breaker.
	auth.AuthorizeTunnel(context.Background(), "r_abc", "")
	if auth.cb.State() != StateOpen {
		t.Fatal("expected open")
	}

	// Fix the service.
	shouldFail.Store(false)
	time.Sleep(60 * time.Millisecond)

	// Should recover.
	err := auth.AuthorizeTunnel(context.Background(), "r_abc", "conn_1")
	if err != nil {
		t.Fatalf("expected nil after recovery, got %v", err)
	}
	if auth.cb.State() != StateClosed {
		t.Fatalf("expected closed after recovery, got %v", auth.cb.State())
	}
}

func TestAuthorizer_RateLimitRejectsExcess(t *testing.T) {
	_, client := mockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(activeResource("r_abc", ""))
	})

	auth := New(client, WithRateLimit(1, 2)) // 1/s, burst 2
	defer auth.Close()

	// First two should succeed (burst).
	for i := range 2 {
		if err := auth.AuthorizeTunnel(context.Background(), "r_"+string(rune('a'+i)), ""); err != nil {
			t.Fatalf("unexpected error on attempt %d: %v", i, err)
		}
	}

	// Third should be rate limited (cache miss, needs API call).
	err := auth.AuthorizeTunnel(context.Background(), "r_new", "")
	if err != ErrRateLimited {
		t.Fatalf("expected ErrRateLimited, got %v", err)
	}
}

func TestAuthorizer_ConnectorMismatchRejects(t *testing.T) {
	_, client := mockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(activeResource("r_abc", "conn_owner"))
	})

	auth := New(client)
	defer auth.Close()

	err := auth.AuthorizeTunnel(context.Background(), "r_abc", "conn_impostor")
	if err != ErrOwnerMismatch {
		t.Fatalf("expected ErrOwnerMismatch, got %v", err)
	}
}

func TestAuthorizer_InactiveResourceRejects(t *testing.T) {
	_, client := mockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		res := activeResource("r_abc", "conn_1")
		res.Status = "disabled"
		json.NewEncoder(w).Encode(res)
	})

	auth := New(client)
	defer auth.Close()

	err := auth.AuthorizeTunnel(context.Background(), "r_abc", "conn_1")
	if err != ErrResourceInactive {
		t.Fatalf("expected ErrResourceInactive, got %v", err)
	}
}

func TestAuthorizer_EmptyConnectorIDSkipsOwnerCheck(t *testing.T) {
	_, client := mockAPI(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(activeResource("r_abc", "conn_owner"))
	})

	auth := New(client)
	defer auth.Close()

	// Empty connectorID should skip ownership check.
	err := auth.AuthorizeTunnel(context.Background(), "r_abc", "")
	if err != nil {
		t.Fatalf("expected nil (no ownership check), got %v", err)
	}
}
