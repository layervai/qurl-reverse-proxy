package tunnelauth

import (
	"sync"
	"time"
)

// TokenBucket implements a token bucket rate limiter with lazy refill.
// No background goroutine is needed; tokens are computed on each Allow call.
type TokenBucket struct {
	mu         sync.Mutex
	tokens     float64
	maxTokens  float64
	refillRate float64 // tokens per second
	lastRefill time.Time
	now        func() time.Time // for testing
}

// newTokenBucket creates a rate limiter that allows rate tokens/sec with
// a burst capacity of burst.
func newTokenBucket(rate float64, burst int, nowFn func() time.Time) *TokenBucket {
	if nowFn == nil {
		nowFn = time.Now
	}
	return &TokenBucket{
		tokens:     float64(burst),
		maxTokens:  float64(burst),
		refillRate: rate,
		lastRefill: nowFn(),
		now:        nowFn,
	}
}

// Allow attempts to consume one token. Returns true if allowed, false if
// the rate limit has been exceeded.
func (tb *TokenBucket) Allow() bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	now := tb.now()
	elapsed := now.Sub(tb.lastRefill).Seconds()
	if elapsed > 0 {
		tb.tokens += elapsed * tb.refillRate
		if tb.tokens > tb.maxTokens {
			tb.tokens = tb.maxTokens
		}
		tb.lastRefill = now
	}

	if tb.tokens < 1 {
		return false
	}
	tb.tokens--
	return true
}
