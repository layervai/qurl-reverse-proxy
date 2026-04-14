package tunnelauth

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/layervai/qurl-reverse-proxy/pkg/apiclient"
)

const resourceStatusActive = "active"

var (
	ErrCircuitOpen      = errors.New("tunnel auth: circuit breaker open, qurl-service unavailable")
	ErrRateLimited      = errors.New("tunnel auth: rate limit exceeded")
	ErrResourceNotFound = errors.New("tunnel auth: resource not found")
	ErrOwnerMismatch    = errors.New("tunnel auth: connector does not own resource")
	ErrResourceInactive = errors.New("tunnel auth: resource is not active")
)

// Authorizer validates tunnel registration requests with resilience.
// It wraps apiclient.Client with a circuit breaker, resource cache,
// and token bucket rate limiter.
type Authorizer struct {
	client  *apiclient.Client
	cb      *CircuitBreaker
	cache   *ResourceCache
	limiter *TokenBucket
	logger  *slog.Logger
}

// Option configures an Authorizer.
type Option func(*config)

type config struct {
	cbFailureThreshold      int
	cbSuccessThreshold      int
	cbOpenDuration          time.Duration
	cbHalfOpenMaxConcurrent int

	cacheTTL             time.Duration
	cacheCleanupInterval time.Duration
	cacheMaxSize         int

	rateLimit float64
	rateBurst int

	logger *slog.Logger
}

func defaultConfig() *config {
	return &config{
		cbFailureThreshold:      5,
		cbSuccessThreshold:      2,
		cbOpenDuration:          30 * time.Second,
		cbHalfOpenMaxConcurrent: 1,

		cacheTTL:             60 * time.Second,
		cacheCleanupInterval: 30 * time.Second,
		cacheMaxSize:         10_000,

		rateLimit: 50,
		rateBurst: 100,

		logger: slog.Default(),
	}
}

// WithCBFailureThreshold sets the number of consecutive failures before
// the circuit breaker trips.
func WithCBFailureThreshold(n int) Option {
	return func(c *config) { c.cbFailureThreshold = n }
}

// WithCBSuccessThreshold sets the number of consecutive successes in
// half-open state required to close the breaker.
func WithCBSuccessThreshold(n int) Option {
	return func(c *config) { c.cbSuccessThreshold = n }
}

// WithCBOpenDuration sets how long the breaker stays open before
// transitioning to half-open.
func WithCBOpenDuration(d time.Duration) Option {
	return func(c *config) { c.cbOpenDuration = d }
}

// WithCacheTTL sets how long a validated resource stays cached.
func WithCacheTTL(d time.Duration) Option {
	return func(c *config) { c.cacheTTL = d }
}

// WithCacheMaxSize sets the maximum number of cached entries.
func WithCacheMaxSize(n int) Option {
	return func(c *config) { c.cacheMaxSize = n }
}

// WithRateLimit sets the outbound request rate (tokens/sec) and burst capacity.
func WithRateLimit(rps float64, burst int) Option {
	return func(c *config) {
		c.rateLimit = rps
		c.rateBurst = burst
	}
}

// WithLogger sets the structured logger.
func WithLogger(l *slog.Logger) Option {
	return func(c *config) { c.logger = l }
}

// New creates an Authorizer that wraps the given apiclient with resilience.
func New(client *apiclient.Client, opts ...Option) *Authorizer {
	cfg := defaultConfig()
	for _, opt := range opts {
		opt(cfg)
	}

	logger := cfg.logger.With("component", "tunnelauth")

	return &Authorizer{
		client: client,
		cb: newCircuitBreaker(
			cfg.cbFailureThreshold,
			cfg.cbSuccessThreshold,
			cfg.cbOpenDuration,
			cfg.cbHalfOpenMaxConcurrent,
			logger,
		),
		cache:   newResourceCache(cfg.cacheTTL, cfg.cacheCleanupInterval, cfg.cacheMaxSize, logger),
		limiter: newTokenBucket(cfg.rateLimit, cfg.rateBurst, nil),
		logger:  logger,
	}
}

// AuthorizeTunnel validates whether a proxy registration is allowed.
// It returns nil if authorized, or an error describing why it was rejected.
// This is fail-closed: any resilience-layer rejection returns an error.
//
// connectorID may be empty if ownership validation is not required.
func (a *Authorizer) AuthorizeTunnel(ctx context.Context, resourceID, connectorID string) error {
	if entry, hit := a.cache.Get(resourceID); hit {
		a.logger.Debug("cache hit",
			"resource_id", resourceID,
			"age_ms", time.Since(entry.ValidatedAt).Milliseconds(),
		)
		if connectorID != "" && entry.ConnectorID != "" && entry.ConnectorID != connectorID {
			return ErrOwnerMismatch
		}
		return nil
	}

	a.logger.Debug("cache miss", "resource_id", resourceID)

	// Check circuit breaker before rate limiter so open-circuit rejections
	// don't consume rate-limit tokens.
	if !a.cb.Allow() {
		a.logger.Warn("circuit open", "resource_id", resourceID)
		return ErrCircuitOpen
	}

	if !a.limiter.Allow() {
		a.logger.Warn("rate limited", "resource_id", resourceID)
		return ErrRateLimited
	}

	resource, err := a.client.GetResource(ctx, resourceID)
	if err != nil {
		if apiclient.IsNotFound(err) {
			a.cb.RecordSuccess()
			return ErrResourceNotFound
		}
		if apiclient.IsForbidden(err) || apiclient.IsUnauthorized(err) {
			a.cb.RecordSuccess()
			return ErrResourceNotFound
		}
		a.cb.RecordFailure()
		return err
	}

	a.cb.RecordSuccess()

	if resource.Status != resourceStatusActive {
		return ErrResourceInactive
	}

	if connectorID != "" && resource.ConnectorID != "" && resource.ConnectorID != connectorID {
		return ErrOwnerMismatch
	}

	a.cache.Put(resourceID, resource.ConnectorID)

	a.logger.Info("allowed",
		"resource_id", resourceID,
		"connector_id", connectorID,
		"source", "api",
	)
	return nil
}

// Close releases resources held by the authorizer.
func (a *Authorizer) Close() {
	a.cache.Close()
}
