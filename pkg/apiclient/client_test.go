package apiclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestDo_SuccessfulGET(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Errorf("expected GET, got %s", r.Method)
		}
		if r.URL.Path != "/v1/test" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "test-token", WithMaxRetries(0))

	var result HealthStatus
	err := c.do(context.Background(), "GET", "/test", nil, &result)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != "ok" {
		t.Errorf("expected status ok, got %s", result.Status)
	}
}

func TestDo_SuccessfulPOST(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("expected Content-Type application/json, got %s", ct)
		}

		var body HeartbeatRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body.ConnectorID != "conn-1" {
			t.Errorf("expected connector_id conn-1, got %s", body.ConnectorID)
		}

		w.WriteHeader(204)
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "test-token", WithMaxRetries(0))

	err := c.do(context.Background(), "POST", "/connectors/heartbeat", &HeartbeatRequest{
		ConnectorID: "conn-1",
		MachineID:   "machine-1",
		Uptime:      3600,
	}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestDo_SuccessfulDELETE(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "DELETE" {
			t.Errorf("expected DELETE, got %s", r.Method)
		}
		w.WriteHeader(204)
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "test-token", WithMaxRetries(0))

	err := c.do(context.Background(), "DELETE", "/resources/res-1", nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestDo_BearerToken(t *testing.T) {
	var gotAuth string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "my-secret-token", WithMaxRetries(0))
	_ = c.do(context.Background(), "GET", "/test", nil, nil)

	if gotAuth != "Bearer my-secret-token" {
		t.Errorf("expected 'Bearer my-secret-token', got %q", gotAuth)
	}
}

func TestDo_UserAgent(t *testing.T) {
	var gotUA string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUA = r.Header.Get("User-Agent")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "tok", WithUserAgent("test-agent/1.0"), WithMaxRetries(0))
	_ = c.do(context.Background(), "GET", "/test", nil, nil)

	if gotUA != "test-agent/1.0" {
		t.Errorf("expected User-Agent 'test-agent/1.0', got %q", gotUA)
	}
}

func TestDo_DefaultUserAgent(t *testing.T) {
	var gotUA string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUA = r.Header.Get("User-Agent")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "tok", WithMaxRetries(0))
	_ = c.do(context.Background(), "GET", "/test", nil, nil)

	if gotUA != defaultUserAgent {
		t.Errorf("expected default User-Agent %q, got %q", defaultUserAgent, gotUA)
	}
}

func TestDo_NotFound(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(404)
		_, _ = w.Write([]byte(`{"status_code":404,"code":"not_found","message":"resource not found"}`))
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "tok", WithMaxRetries(0))
	err := c.do(context.Background(), "GET", "/resources/missing", nil, nil)

	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !IsNotFound(err) {
		t.Errorf("expected IsNotFound to be true, got false: %v", err)
	}
	if IsUnauthorized(err) {
		t.Error("expected IsUnauthorized to be false")
	}
}

func TestDo_Unauthorized(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"status_code":401,"code":"unauthorized","message":"bad token"}`))
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "bad-tok", WithMaxRetries(0))
	err := c.do(context.Background(), "GET", "/test", nil, nil)

	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !IsUnauthorized(err) {
		t.Errorf("expected IsUnauthorized to be true: %v", err)
	}
	if IsNotFound(err) {
		t.Error("expected IsNotFound to be false")
	}
}

func TestDo_Retry429(t *testing.T) {
	var calls atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		if n <= 2 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(429)
			_, _ = w.Write([]byte(`{"status_code":429,"code":"rate_limited","message":"slow down"}`))
			return
		}
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer ts.Close()

	// Use a short-backoff client for test speed. We override the internal
	// backoff by using a custom HTTP client with a short timeout so the
	// test doesn't take too long.
	c := New(ts.URL+"/v1", "tok", WithMaxRetries(3))

	var result HealthStatus
	err := c.do(context.Background(), "GET", "/test", nil, &result)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got := int(calls.Load())
	if got < 2 {
		t.Errorf("expected at least 2 calls for 429 retry, got %d", got)
	}
}

func TestDo_Retry500(t *testing.T) {
	var calls atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		if n <= 2 {
			w.WriteHeader(500)
			_, _ = w.Write([]byte(`{"status_code":500,"code":"internal","message":"oops"}`))
			return
		}
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "tok", WithMaxRetries(3))

	var result HealthStatus
	err := c.do(context.Background(), "GET", "/test", nil, &result)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got := int(calls.Load())
	if got < 2 {
		t.Errorf("expected multiple calls for 500 retry, got %d", got)
	}
}

func TestDo_NoRetryOn400(t *testing.T) {
	var calls atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"status_code":400,"code":"bad_request","message":"invalid"}`))
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "tok", WithMaxRetries(3))
	err := c.do(context.Background(), "GET", "/test", nil, nil)

	if err == nil {
		t.Fatal("expected error, got nil")
	}
	got := int(calls.Load())
	if got != 1 {
		t.Errorf("expected exactly 1 call for 400 (no retry), got %d", got)
	}
}

func TestDo_Timeout(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Sleep longer than the client timeout.
		time.Sleep(200 * time.Millisecond)
		w.WriteHeader(200)
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "tok", WithTimeout(50*time.Millisecond), WithMaxRetries(0))
	err := c.do(context.Background(), "GET", "/test", nil, nil)

	if err == nil {
		t.Fatal("expected timeout error, got nil")
	}
}

func TestDo_APIErrorFields(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(422)
		_, _ = w.Write([]byte(`{"status_code":422,"code":"validation_error","message":"name required","request_id":"req-abc"}`))
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "tok", WithMaxRetries(0))
	err := c.do(context.Background(), "POST", "/resources", &CreateResourceRequest{}, nil)

	if err == nil {
		t.Fatal("expected error, got nil")
	}

	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("expected *APIError, got %T", err)
	}

	if apiErr.StatusCode != 422 {
		t.Errorf("expected status 422, got %d", apiErr.StatusCode)
	}
	if apiErr.Code != "validation_error" {
		t.Errorf("expected code validation_error, got %s", apiErr.Code)
	}
	if apiErr.Message != "name required" {
		t.Errorf("expected message 'name required', got %s", apiErr.Message)
	}
	if apiErr.RequestID != "req-abc" {
		t.Errorf("expected request_id req-abc, got %s", apiErr.RequestID)
	}

	// Verify Error() includes the request ID.
	errStr := apiErr.Error()
	if got := "qurl api error 422 (validation_error): name required [request_id=req-abc]"; errStr != got {
		t.Errorf("Error() = %q, want %q", errStr, got)
	}
}

func TestIsServerError(t *testing.T) {
	tests := []struct {
		status int
		want   bool
	}{
		{500, true},
		{502, true},
		{503, true},
		{599, true},
		{400, false},
		{404, false},
		{429, false},
		{200, false},
	}
	for _, tt := range tests {
		err := &APIError{StatusCode: tt.status}
		if got := IsServerError(err); got != tt.want {
			t.Errorf("IsServerError(%d) = %v, want %v", tt.status, got, tt.want)
		}
	}
}

func TestIsForbidden(t *testing.T) {
	err := &APIError{StatusCode: 403, Code: "forbidden"}
	if !IsForbidden(err) {
		t.Error("expected IsForbidden to be true for 403")
	}
	err2 := &APIError{StatusCode: 401}
	if IsForbidden(err2) {
		t.Error("expected IsForbidden to be false for 401")
	}
}

func TestIsRateLimited(t *testing.T) {
	err := &APIError{StatusCode: 429, Code: "rate_limited"}
	if !IsRateLimited(err) {
		t.Error("expected IsRateLimited to be true for 429")
	}
	err2 := &APIError{StatusCode: 500}
	if IsRateLimited(err2) {
		t.Error("expected IsRateLimited to be false for 500")
	}
}

func TestNew_Defaults(t *testing.T) {
	c := New("", "tok")
	if c.baseURL != defaultBaseURL {
		t.Errorf("expected default baseURL %q, got %q", defaultBaseURL, c.baseURL)
	}
	if c.userAgent != defaultUserAgent {
		t.Errorf("expected default userAgent %q, got %q", defaultUserAgent, c.userAgent)
	}
	if c.maxRetries != defaultMaxRetries {
		t.Errorf("expected default maxRetries %d, got %d", defaultMaxRetries, c.maxRetries)
	}
	if c.token != "tok" {
		t.Errorf("expected token 'tok', got %q", c.token)
	}
}

func TestNew_TrailingSlash(t *testing.T) {
	c := New("https://example.com/v1/", "tok")
	if c.baseURL != "https://example.com/v1" {
		t.Errorf("expected trailing slash stripped, got %q", c.baseURL)
	}
}

func TestWithMaxRetries_Negative(t *testing.T) {
	c := New("", "tok", WithMaxRetries(-1))
	if c.maxRetries != 0 {
		t.Errorf("expected negative retries clamped to 0, got %d", c.maxRetries)
	}
}

func TestBackoffDuration(t *testing.T) {
	backoffs := []time.Duration{
		500 * time.Millisecond,
		1 * time.Second,
		2 * time.Second,
		4 * time.Second,
	}

	// Run multiple times to check jitter range.
	for attempt := range 4 {
		for range 20 {
			d := backoffDuration(backoffs, attempt)
			base := backoffs[attempt]
			minD := time.Duration(float64(base) * 0.75)
			maxD := time.Duration(float64(base) * 1.25)
			if d < minD || d >= maxD {
				t.Errorf("attempt %d: backoff %v outside [%v, %v)", attempt, d, minD, maxD)
			}
		}
	}

	// Attempt beyond length should clamp to last index.
	for range 20 {
		d := backoffDuration(backoffs, 10)
		base := backoffs[len(backoffs)-1]
		minD := time.Duration(float64(base) * 0.75)
		maxD := time.Duration(float64(base) * 1.25)
		if d < minD || d >= maxD {
			t.Errorf("attempt 10: backoff %v outside [%v, %v)", d, minD, maxD)
		}
	}
}
