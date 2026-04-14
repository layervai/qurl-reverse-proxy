package tunnelauth

import (
	"log/slog"
	"sync"
	"testing"
	"time"
)

func newTestCB(failThresh, succThresh int, openDur time.Duration) *CircuitBreaker {
	return newCircuitBreaker(failThresh, succThresh, openDur, 1, slog.Default())
}

func TestCircuitBreaker_StartsClosedAllowsRequests(t *testing.T) {
	cb := newTestCB(3, 2, time.Second)
	if !cb.Allow() {
		t.Fatal("expected Allow to return true in closed state")
	}
	if cb.State() != StateClosed {
		t.Fatalf("expected StateClosed, got %v", cb.State())
	}
}

func TestCircuitBreaker_TripsAfterThreshold(t *testing.T) {
	cb := newTestCB(3, 2, time.Second)

	for range 3 {
		cb.Allow()
		cb.RecordFailure()
	}

	if cb.State() != StateOpen {
		t.Fatalf("expected StateOpen after %d failures, got %v", 3, cb.State())
	}
}

func TestCircuitBreaker_OpenRejectsRequests(t *testing.T) {
	cb := newTestCB(1, 1, 10*time.Second)
	cb.Allow()
	cb.RecordFailure()

	if cb.Allow() {
		t.Fatal("expected Allow to return false in open state")
	}
}

func TestCircuitBreaker_TransitionsToHalfOpen(t *testing.T) {
	cb := newTestCB(1, 1, 50*time.Millisecond)

	// Trip the breaker.
	cb.Allow()
	cb.RecordFailure()
	if cb.State() != StateOpen {
		t.Fatalf("expected StateOpen, got %v", cb.State())
	}

	// Wait for openDuration to elapse.
	time.Sleep(60 * time.Millisecond)

	// Next Allow should transition to half-open and succeed.
	if !cb.Allow() {
		t.Fatal("expected Allow to return true after openDuration elapsed")
	}
	if cb.State() != StateHalfOpen {
		t.Fatalf("expected StateHalfOpen, got %v", cb.State())
	}
}

func TestCircuitBreaker_HalfOpenRecovery(t *testing.T) {
	cb := newTestCB(1, 2, 50*time.Millisecond)

	// Trip → open → wait → half-open.
	cb.Allow()
	cb.RecordFailure()
	time.Sleep(60 * time.Millisecond)
	cb.Allow() // transitions to half-open, first probe
	cb.RecordSuccess()

	// Second probe.
	if !cb.Allow() {
		t.Fatal("expected Allow for second half-open probe")
	}
	cb.RecordSuccess()

	if cb.State() != StateClosed {
		t.Fatalf("expected StateClosed after recovery, got %v", cb.State())
	}
}

func TestCircuitBreaker_HalfOpenFailureReopens(t *testing.T) {
	cb := newTestCB(1, 2, 50*time.Millisecond)

	// Trip → open → wait → half-open.
	cb.Allow()
	cb.RecordFailure()
	time.Sleep(60 * time.Millisecond)
	cb.Allow() // transitions to half-open
	cb.RecordFailure()

	if cb.State() != StateOpen {
		t.Fatalf("expected StateOpen after half-open failure, got %v", cb.State())
	}
}

func TestCircuitBreaker_HalfOpenLimitsConcurrency(t *testing.T) {
	cb := newTestCB(1, 2, 50*time.Millisecond)

	// Trip and wait for half-open.
	cb.Allow()
	cb.RecordFailure()
	time.Sleep(60 * time.Millisecond)

	// First probe should succeed (transitions to half-open).
	if !cb.Allow() {
		t.Fatal("expected first half-open probe to be allowed")
	}

	// Second concurrent probe should be rejected (halfOpenMaxConcurrent = 1).
	if cb.Allow() {
		t.Fatal("expected second concurrent half-open probe to be rejected")
	}
}

func TestCircuitBreaker_SuccessResetsFailureCount(t *testing.T) {
	cb := newTestCB(3, 2, time.Second)

	// Two failures, then a success should reset counter.
	cb.Allow()
	cb.RecordFailure()
	cb.Allow()
	cb.RecordFailure()
	cb.Allow()
	cb.RecordSuccess()

	// Two more failures should NOT trip (counter was reset).
	cb.Allow()
	cb.RecordFailure()
	cb.Allow()
	cb.RecordFailure()

	if cb.State() != StateClosed {
		t.Fatalf("expected StateClosed (counter was reset), got %v", cb.State())
	}
}

func TestCircuitBreaker_ConcurrentAccess(t *testing.T) {
	cb := newTestCB(100, 2, time.Second)

	var wg sync.WaitGroup
	for range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 20 {
				if cb.Allow() {
					cb.RecordSuccess()
				}
			}
		}()
	}
	wg.Wait()

	if cb.State() != StateClosed {
		t.Fatalf("expected StateClosed after concurrent successes, got %v", cb.State())
	}
}

func TestBreakerState_String(t *testing.T) {
	tests := []struct {
		state BreakerState
		want  string
	}{
		{StateClosed, "closed"},
		{StateOpen, "open"},
		{StateHalfOpen, "half-open"},
		{BreakerState(99), "unknown"},
	}
	for _, tt := range tests {
		if got := tt.state.String(); got != tt.want {
			t.Errorf("BreakerState(%d).String() = %q, want %q", tt.state, got, tt.want)
		}
	}
}
