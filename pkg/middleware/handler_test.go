package middleware

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/layervai/qurl-reverse-proxy/pkg/audit"
	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// mockAuditLogger collects audit entries in a slice for assertions.
type mockAuditLogger struct {
	mu      sync.Mutex
	entries []audit.Entry
}

func (m *mockAuditLogger) Log(entry audit.Entry) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.entries = append(m.entries, entry)
}

func (m *mockAuditLogger) Close() error { return nil }

func (m *mockAuditLogger) Entries() []audit.Entry {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]audit.Entry, len(m.entries))
	copy(out, m.entries)
	return out
}

// handlerTestFixture holds shared test state.
type handlerTestFixture struct {
	privateKey *rsa.PrivateKey
	publicPEM  []byte
	registry   *SimpleRouteRegistry
	logger     *mockAuditLogger
}

func newHandlerTestFixture(t *testing.T) *handlerTestFixture {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate RSA key: %v", err)
	}

	pubBytes, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatalf("failed to marshal public key: %v", err)
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pubBytes,
	})

	registry := NewSimpleRouteRegistry()
	registry.Register("res-1")

	return &handlerTestFixture{
		privateKey: key,
		publicPEM:  pubPEM,
		registry:   registry,
		logger:     &mockAuditLogger{},
	}
}

func (f *handlerTestFixture) signToken(t *testing.T, claims Claims) string {
	t.Helper()

	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: f.privateKey},
		(&jose.SignerOptions{}).WithType("JWT"),
	)
	if err != nil {
		t.Fatalf("failed to create signer: %v", err)
	}

	token, err := jwt.Signed(signer).Claims(claims).Serialize()
	if err != nil {
		t.Fatalf("failed to serialize token: %v", err)
	}
	return token
}

func (f *handlerTestFixture) newMiddleware(t *testing.T, downstream http.Handler) *SessionMiddleware {
	t.Helper()

	mw, err := New(Config{
		PublicKeyPEM:  f.publicPEM,
		ClockSkew:     30 * time.Second,
		Enabled:       true,
		AuditLogger:   f.logger,
		RouteRegistry: f.registry,
	}, downstream)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}
	return mw
}

// downstreamOK is a simple handler that writes "OK" when reached.
var downstreamOK = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("OK"))
})

func TestHandler_NoToken(t *testing.T) {
	f := newHandlerTestFixture(t)
	mw := f.newMiddleware(t, downstreamOK)
	defer mw.Close()

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()

	mw.ServeHTTP(rr, req)

	// httptest.ResponseRecorder does not implement http.Hijacker,
	// so silentDrop falls back to returning without writing a response.
	// The default status from httptest.NewRecorder is 200, but no body is written.
	// We check via audit log instead.

	entries := f.logger.Entries()
	if len(entries) != 1 {
		t.Fatalf("expected 1 audit entry, got %d", len(entries))
	}
	if entries[0].Action != audit.ActionDenyNoSession {
		t.Errorf("audit action = %q, want %q", entries[0].Action, audit.ActionDenyNoSession)
	}
}

func TestHandler_ValidToken(t *testing.T) {
	f := newHandlerTestFixture(t)
	mw := f.newMiddleware(t, downstreamOK)
	defer mw.Close()

	token := f.signToken(t, Claims{
		SessionID:  "sess-1",
		ResourceID: "res-1",
		Subject:    "user@example.com",
		IssuedAt:   time.Now().Unix(),
		ExpiresAt:  time.Now().Add(5 * time.Minute).Unix(),
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Qurl-Token", token)
	rr := httptest.NewRecorder()

	mw.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}

	body, _ := io.ReadAll(rr.Body)
	if string(body) != "OK" {
		t.Errorf("body = %q, want %q", body, "OK")
	}

	entries := f.logger.Entries()
	if len(entries) != 1 {
		t.Fatalf("expected 1 audit entry, got %d", len(entries))
	}
	if entries[0].Action != audit.ActionAllow {
		t.Errorf("audit action = %q, want %q", entries[0].Action, audit.ActionAllow)
	}
	if entries[0].SessionID != "sess-1" {
		t.Errorf("audit session_id = %q, want %q", entries[0].SessionID, "sess-1")
	}
	if entries[0].ResourceID != "res-1" {
		t.Errorf("audit resource_id = %q, want %q", entries[0].ResourceID, "res-1")
	}
}

func TestHandler_ExpiredToken(t *testing.T) {
	f := newHandlerTestFixture(t)
	mw := f.newMiddleware(t, downstreamOK)
	defer mw.Close()

	token := f.signToken(t, Claims{
		SessionID:  "sess-2",
		ResourceID: "res-1",
		Subject:    "user@example.com",
		IssuedAt:   time.Now().Add(-10 * time.Minute).Unix(),
		ExpiresAt:  time.Now().Add(-5 * time.Minute).Unix(),
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Qurl-Token", token)
	rr := httptest.NewRecorder()

	mw.ServeHTTP(rr, req)

	entries := f.logger.Entries()
	if len(entries) != 1 {
		t.Fatalf("expected 1 audit entry, got %d", len(entries))
	}
	if entries[0].Action != audit.ActionDenyExpired {
		t.Errorf("audit action = %q, want %q", entries[0].Action, audit.ActionDenyExpired)
	}
}

func TestHandler_UnknownResource(t *testing.T) {
	f := newHandlerTestFixture(t)
	mw := f.newMiddleware(t, downstreamOK)
	defer mw.Close()

	token := f.signToken(t, Claims{
		SessionID:  "sess-3",
		ResourceID: "res-unknown",
		Subject:    "user@example.com",
		IssuedAt:   time.Now().Unix(),
		ExpiresAt:  time.Now().Add(5 * time.Minute).Unix(),
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Qurl-Token", token)
	rr := httptest.NewRecorder()

	mw.ServeHTTP(rr, req)

	entries := f.logger.Entries()
	if len(entries) != 1 {
		t.Fatalf("expected 1 audit entry, got %d", len(entries))
	}
	if entries[0].Action != audit.ActionDenyUnknownResource {
		t.Errorf("audit action = %q, want %q", entries[0].Action, audit.ActionDenyUnknownResource)
	}
}

func TestHandler_OneTimeUseReplay(t *testing.T) {
	f := newHandlerTestFixture(t)
	mw := f.newMiddleware(t, downstreamOK)
	defer mw.Close()

	token := f.signToken(t, Claims{
		SessionID:  "sess-otu",
		ResourceID: "res-1",
		Subject:    "user@example.com",
		IssuedAt:   time.Now().Unix(),
		ExpiresAt:  time.Now().Add(5 * time.Minute).Unix(),
		OneTimeUse: true,
	})

	// First request should succeed.
	req1 := httptest.NewRequest(http.MethodGet, "/", nil)
	req1.Header.Set("X-Qurl-Token", token)
	rr1 := httptest.NewRecorder()
	mw.ServeHTTP(rr1, req1)

	if rr1.Code != http.StatusOK {
		t.Errorf("first one-time-use request: expected 200, got %d", rr1.Code)
	}

	// Second request with the same token should be dropped.
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.Header.Set("X-Qurl-Token", token)
	rr2 := httptest.NewRecorder()
	mw.ServeHTTP(rr2, req2)

	entries := f.logger.Entries()
	if len(entries) != 2 {
		t.Fatalf("expected 2 audit entries, got %d", len(entries))
	}
	if entries[0].Action != audit.ActionAllow {
		t.Errorf("first audit action = %q, want %q", entries[0].Action, audit.ActionAllow)
	}
	if entries[1].Action != audit.ActionDenyOneTimeConsumed {
		t.Errorf("second audit action = %q, want %q", entries[1].Action, audit.ActionDenyOneTimeConsumed)
	}
}

func TestHandler_DisabledPassesThrough(t *testing.T) {
	logger := &mockAuditLogger{}

	mw, err := New(Config{
		Enabled:     false,
		AuditLogger: logger,
	}, downstreamOK)
	if err != nil {
		t.Fatalf("New() failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("disabled middleware: expected 200, got %d", rr.Code)
	}
}

func TestHandler_MalformedToken(t *testing.T) {
	f := newHandlerTestFixture(t)
	mw := f.newMiddleware(t, downstreamOK)
	defer mw.Close()

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Qurl-Token", "not-a-jwt-at-all")
	rr := httptest.NewRecorder()

	mw.ServeHTTP(rr, req)

	entries := f.logger.Entries()
	if len(entries) != 1 {
		t.Fatalf("expected 1 audit entry, got %d", len(entries))
	}
	if entries[0].Action != audit.ActionDenyMalformed {
		t.Errorf("audit action = %q, want %q", entries[0].Action, audit.ActionDenyMalformed)
	}
}
