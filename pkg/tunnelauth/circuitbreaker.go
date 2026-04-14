package tunnelauth

import (
	"log/slog"
	"sync"
	"time"
)

// BreakerState represents the current state of the circuit breaker.
type BreakerState int

const (
	StateClosed   BreakerState = iota // Normal operation; requests pass through.
	StateOpen                         // Failures exceeded threshold; all requests rejected.
	StateHalfOpen                     // Probing recovery; limited requests allowed.
)

func (s BreakerState) String() string {
	switch s {
	case StateClosed:
		return "closed"
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

// CircuitBreaker implements a three-state circuit breaker that protects
// outbound calls to qurl-service. When the breaker is open, all requests
// are immediately rejected (fail-closed).
type CircuitBreaker struct {
	mu sync.RWMutex

	state            BreakerState
	failures         int // consecutive failures in closed state
	successes        int // consecutive successes in half-open state
	lastFailure      time.Time
	halfOpenInFlight int

	failureThreshold      int
	successThreshold      int
	openDuration          time.Duration
	halfOpenMaxConcurrent int

	logger *slog.Logger
	now    func() time.Time // for testing
}

func newCircuitBreaker(failureThreshold, successThreshold int, openDuration time.Duration, halfOpenMax int, logger *slog.Logger) *CircuitBreaker {
	return &CircuitBreaker{
		state:                 StateClosed,
		failureThreshold:      failureThreshold,
		successThreshold:      successThreshold,
		openDuration:          openDuration,
		halfOpenMaxConcurrent: halfOpenMax,
		logger:                logger,
		now:                   time.Now,
	}
}

// Allow checks whether a request should proceed. Returns false if the
// breaker is open and not yet ready to probe, or if the half-open state
// has reached its concurrent probe limit.
func (cb *CircuitBreaker) Allow() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case StateClosed:
		return true

	case StateOpen:
		if cb.now().Sub(cb.lastFailure) < cb.openDuration {
			return false
		}
		prev := cb.state
		cb.state = StateHalfOpen
		cb.successes = 0
		cb.halfOpenInFlight = 1
		cb.logger.Info("circuit breaker state change",
			"from", prev.String(),
			"to", cb.state.String(),
		)
		return true

	case StateHalfOpen:
		if cb.halfOpenInFlight >= cb.halfOpenMaxConcurrent {
			return false
		}
		cb.halfOpenInFlight++
		return true
	}

	return false
}

func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case StateClosed:
		cb.failures = 0

	case StateHalfOpen:
		cb.halfOpenInFlight--
		cb.successes++
		if cb.successes >= cb.successThreshold {
			prev := cb.state
			cb.state = StateClosed
			cb.failures = 0
			cb.logger.Info("circuit breaker state change",
				"from", prev.String(),
				"to", cb.state.String(),
			)
		}
	}
}

func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case StateClosed:
		cb.failures++
		if cb.failures >= cb.failureThreshold {
			prev := cb.state
			cb.state = StateOpen
			cb.lastFailure = cb.now()
			cb.logger.Warn("circuit breaker state change",
				"from", prev.String(),
				"to", cb.state.String(),
				"consecutive_failures", cb.failures,
			)
		}

	case StateHalfOpen:
		cb.halfOpenInFlight--
		prev := cb.state
		cb.state = StateOpen
		cb.lastFailure = cb.now()
		cb.successes = 0
		cb.logger.Warn("circuit breaker state change",
			"from", prev.String(),
			"to", cb.state.String(),
		)
	}
}

func (cb *CircuitBreaker) State() BreakerState {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return cb.state
}
