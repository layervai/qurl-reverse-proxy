package tunnelauth

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestTokenBucket_AllowsWithinBurst(t *testing.T) {
	tb := newTokenBucket(10, 5, nil) // 10/s, burst 5

	for i := range 5 {
		if !tb.Allow() {
			t.Fatalf("expected Allow on attempt %d (within burst)", i)
		}
	}
}

func TestTokenBucket_RejectsOverLimit(t *testing.T) {
	tb := newTokenBucket(10, 3, nil)

	// Drain the bucket.
	for range 3 {
		tb.Allow()
	}

	if tb.Allow() {
		t.Fatal("expected rejection after burst exhausted")
	}
}

func TestTokenBucket_RefillsOverTime(t *testing.T) {
	tb := newTokenBucket(100, 1, nil) // 100/s, burst 1

	// Drain.
	tb.Allow()
	if tb.Allow() {
		t.Fatal("expected rejection right after drain")
	}

	// Wait for one token to refill (~10ms at 100/s).
	time.Sleep(20 * time.Millisecond)

	if !tb.Allow() {
		t.Fatal("expected Allow after refill period")
	}
}

func TestTokenBucket_DoesNotExceedMax(t *testing.T) {
	now := time.Now()
	tb := newTokenBucket(1000, 5, func() time.Time { return now })

	// Drain all tokens.
	for range 5 {
		tb.Allow()
	}

	// Advance time significantly — should refill to max (5), not beyond.
	now = now.Add(10 * time.Second) // 10,000 tokens would refill, but capped at 5

	allowed := 0
	for range 10 {
		if tb.Allow() {
			allowed++
		}
	}
	if allowed != 5 {
		t.Fatalf("expected 5 allowed after refill to max, got %d", allowed)
	}
}

func TestTokenBucket_ConcurrentAccess(t *testing.T) {
	tb := newTokenBucket(1000, 100, nil)
	var allowed atomic.Int64

	var wg sync.WaitGroup
	for range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 10 {
				if tb.Allow() {
					allowed.Add(1)
				}
			}
		}()
	}
	wg.Wait()

	// With burst 100, exactly 100 should be allowed (all 500 requests
	// happen near-instantly, so ~100 tokens available).
	got := allowed.Load()
	if got < 95 || got > 105 {
		t.Fatalf("expected ~100 allowed, got %d", got)
	}
}
