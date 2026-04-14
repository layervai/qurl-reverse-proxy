package tunnelauth

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/layervai/qurl-reverse-proxy/pkg/apiclient"
)

func newTestHandler(t *testing.T, apiHandler http.HandlerFunc) *Handler {
	t.Helper()
	srv := httptest.NewServer(apiHandler)
	t.Cleanup(srv.Close)
	client := apiclient.New(srv.URL, "test-token", apiclient.WithMaxRetries(0))
	auth := New(client, WithCacheTTL(time.Minute))
	t.Cleanup(auth.Close)
	return NewHandler(auth, nil)
}

func makePluginRequest(op string, content any) []byte {
	b, _ := json.Marshal(map[string]any{
		"version": "0.1.0",
		"op":      op,
		"content": content,
	})
	return b
}

func TestHandler_ValidNewProxy(t *testing.T) {
	h := newTestHandler(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(activeResource("r_abc", ""))
	})

	body := makePluginRequest("NewProxy", map[string]any{
		"proxy_name": "myapp",
		"proxy_type": "http",
		"subdomain":  "r_abc",
		"user":       map[string]any{"user": "", "run_id": "test-run"},
	})

	req := httptest.NewRequest(http.MethodPost, "/internal/v1/tunnel/auth", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp pluginResponse
	json.NewDecoder(rec.Body).Decode(&resp)
	if resp.Reject {
		t.Fatalf("expected reject=false, got reject=true reason=%q", resp.RejectReason)
	}
}

func TestHandler_RejectedNewProxy(t *testing.T) {
	h := newTestHandler(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]any{"status_code": 404})
	})

	body := makePluginRequest("NewProxy", map[string]any{
		"proxy_name": "myapp",
		"subdomain":  "r_missing",
		"user":       map[string]any{"user": "", "run_id": ""},
	})

	req := httptest.NewRequest(http.MethodPost, "/internal/v1/tunnel/auth", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var resp pluginResponse
	json.NewDecoder(rec.Body).Decode(&resp)
	if !resp.Reject {
		t.Fatal("expected reject=true for missing resource")
	}
}

func TestHandler_NonNewProxyOpPassesThrough(t *testing.T) {
	h := newTestHandler(t, func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("API should not be called for non-NewProxy ops")
	})

	body := makePluginRequest("Login", map[string]any{"user": "admin"})

	req := httptest.NewRequest(http.MethodPost, "/internal/v1/tunnel/auth", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var resp pluginResponse
	json.NewDecoder(rec.Body).Decode(&resp)
	if resp.Reject {
		t.Fatal("expected reject=false for non-NewProxy op")
	}
	if !resp.Unchange {
		t.Fatal("expected unchange=true for non-NewProxy op")
	}
}

func TestHandler_MalformedRequest(t *testing.T) {
	h := newTestHandler(t, func(w http.ResponseWriter, r *http.Request) {})

	req := httptest.NewRequest(http.MethodPost, "/internal/v1/tunnel/auth", bytes.NewReader([]byte("not json")))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestHandler_MethodNotAllowed(t *testing.T) {
	h := newTestHandler(t, func(w http.ResponseWriter, r *http.Request) {})

	req := httptest.NewRequest(http.MethodGet, "/internal/v1/tunnel/auth", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec.Code)
	}
}

func TestHandler_MissingResourceID(t *testing.T) {
	h := newTestHandler(t, func(w http.ResponseWriter, r *http.Request) {})

	body := makePluginRequest("NewProxy", map[string]any{
		"proxy_name": "",
		"subdomain":  "",
		"user":       map[string]any{"user": "", "run_id": ""},
	})

	req := httptest.NewRequest(http.MethodPost, "/internal/v1/tunnel/auth", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var resp pluginResponse
	json.NewDecoder(rec.Body).Decode(&resp)
	if !resp.Reject {
		t.Fatal("expected reject=true for missing resource ID")
	}
}

func TestHandler_ResourceIDFromMetas(t *testing.T) {
	h := newTestHandler(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(activeResource("r_from_meta", ""))
	})

	body := makePluginRequest("NewProxy", map[string]any{
		"proxy_name": "irrelevant",
		"subdomain":  "also_irrelevant",
		"metas":      map[string]string{"resource_id": "r_from_meta"},
		"user":       map[string]any{"user": "", "run_id": ""},
	})

	req := httptest.NewRequest(http.MethodPost, "/internal/v1/tunnel/auth", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var resp pluginResponse
	json.NewDecoder(rec.Body).Decode(&resp)
	if resp.Reject {
		t.Fatalf("expected reject=false, got reject=true reason=%q", resp.RejectReason)
	}
}

func TestExtractResourceID_Priority(t *testing.T) {
	tests := []struct {
		name  string
		input newProxyContent
		want  string
	}{
		{
			name:  "metas takes priority",
			input: newProxyContent{Metas: map[string]string{"resource_id": "from_meta"}, SubDomain: "from_sub", ProxyName: "from_name"},
			want:  "from_meta",
		},
		{
			name:  "subdomain second",
			input: newProxyContent{SubDomain: "from_sub", ProxyName: "from_name"},
			want:  "from_sub",
		},
		{
			name:  "proxy name fallback",
			input: newProxyContent{ProxyName: "from_name"},
			want:  "from_name",
		},
		{
			name:  "empty returns empty",
			input: newProxyContent{},
			want:  "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractResourceID(tt.input)
			if got != tt.want {
				t.Errorf("extractResourceID() = %q, want %q", got, tt.want)
			}
		})
	}
}
