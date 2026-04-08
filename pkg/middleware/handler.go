package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/layervai/qurl-reverse-proxy/pkg/audit"
)

// Config for the session middleware.
type Config struct {
	PublicKeyPEM  []byte
	ClockSkew     time.Duration
	TokenHeader   string // default: "X-Qurl-Token"
	Enabled       bool
	AuditLogger   audit.Logger
	RouteRegistry RouteRegistry
}

// RouteRegistry checks if a resource ID is known.
type RouteRegistry interface {
	HasResource(resourceID string) bool
}

// SimpleRouteRegistry is a basic in-memory implementation of RouteRegistry.
type SimpleRouteRegistry struct {
	mu        sync.RWMutex
	resources map[string]bool
}

// NewSimpleRouteRegistry creates an empty route registry.
func NewSimpleRouteRegistry() *SimpleRouteRegistry {
	return &SimpleRouteRegistry{
		resources: make(map[string]bool),
	}
}

// Register adds a resource ID to the registry.
func (r *SimpleRouteRegistry) Register(resourceID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.resources[resourceID] = true
}

// Deregister removes a resource ID from the registry.
func (r *SimpleRouteRegistry) Deregister(resourceID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.resources, resourceID)
}

// HasResource reports whether the resource ID is registered.
func (r *SimpleRouteRegistry) HasResource(resourceID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.resources[resourceID]
}

// SessionMiddleware validates session tokens on incoming HTTP requests.
type SessionMiddleware struct {
	validator   *SessionValidator
	otuStore    *OneTimeUseStore
	auditLogger audit.Logger
	registry    RouteRegistry
	tokenHeader string
	downstream  http.Handler
}

// New creates a SessionMiddleware from the given configuration.
// If cfg.Enabled is false, the returned middleware passes all requests through.
func New(cfg Config, downstream http.Handler) (*SessionMiddleware, error) {
	header := cfg.TokenHeader
	if header == "" {
		header = "X-Qurl-Token"
	}

	if !cfg.Enabled {
		return &SessionMiddleware{
			tokenHeader: header,
			auditLogger: cfg.AuditLogger,
			registry:    cfg.RouteRegistry,
			downstream:  downstream,
		}, nil
	}

	validator, err := NewSessionValidator(cfg.PublicKeyPEM, cfg.ClockSkew)
	if err != nil {
		return nil, err
	}

	return &SessionMiddleware{
		validator:   validator,
		otuStore:    NewOneTimeUseStore(0),
		auditLogger: cfg.AuditLogger,
		registry:    cfg.RouteRegistry,
		tokenHeader: header,
		downstream:  downstream,
	}, nil
}

// ServeHTTP implements http.Handler. It validates the session token and either
// forwards the request to the downstream handler or silently drops the connection.
func (m *SessionMiddleware) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// If middleware is disabled (no validator), pass through.
	if m.validator == nil {
		m.downstream.ServeHTTP(w, r)
		return
	}

	tokenString := r.Header.Get(m.tokenHeader)

	if tokenString == "" {
		m.audit(r, audit.ActionDenyNoSession, nil, ErrNoToken.Error())
		silentDrop(w)
		return
	}

	claims, err := m.validator.Validate(tokenString)
	if err != nil {
		action := auditActionForError(err)
		m.audit(r, action, nil, err.Error())
		silentDrop(w)
		return
	}

	// Check resource ID against registry.
	if m.registry != nil && !m.registry.HasResource(claims.ResourceID) {
		m.audit(r, audit.ActionDenyUnknownResource, claims, "unknown resource: "+claims.ResourceID)
		silentDrop(w)
		return
	}

	// Check one-time-use tokens.
	if claims.OneTimeUse {
		expiry := time.Unix(claims.ExpiresAt, 0)
		if !m.otuStore.MarkUsed(claims.SessionID, expiry) {
			m.audit(r, audit.ActionDenyOneTimeConsumed, claims, "one-time token already consumed")
			silentDrop(w)
			return
		}
	}

	// All checks passed.
	m.audit(r, audit.ActionAllow, claims, "")
	m.downstream.ServeHTTP(w, r)
}

// Close releases resources held by the middleware.
func (m *SessionMiddleware) Close() {
	if m.otuStore != nil {
		m.otuStore.Close()
	}
}

func (m *SessionMiddleware) audit(r *http.Request, action audit.Action, claims *Claims, errMsg string) {
	if m.auditLogger == nil {
		return
	}

	entry := audit.Entry{
		Timestamp: time.Now().UTC(),
		Event:     "access_attempt",
		Action:    action,
		SourceIP:  r.RemoteAddr,
		Error:     errMsg,
	}

	if claims != nil {
		entry.SessionID = claims.SessionID
		entry.ResourceID = claims.ResourceID
		entry.Subject = claims.Subject
	}

	m.auditLogger.Log(entry)
}

func auditActionForError(err error) audit.Action {
	switch err {
	case ErrTokenExpired:
		return audit.ActionDenyExpired
	case ErrInvalidSignature:
		return audit.ActionDenyInvalidSignature
	case ErrMissingClaims:
		return audit.ActionDenyMissingClaims
	case ErrMalformedToken:
		return audit.ActionDenyMalformed
	default:
		return audit.ActionDenyMalformed
	}
}

// silentDrop closes the underlying TCP connection without sending an HTTP response.
// This makes the server appear invisible to unauthorized clients.
func silentDrop(w http.ResponseWriter) {
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		// Fallback: send nothing and return.
		return
	}
	conn, _, err := hijacker.Hijack()
	if err != nil {
		return
	}
	conn.Close()
}
