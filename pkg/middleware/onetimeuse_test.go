package middleware

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestOneTimeUseStore_FirstUseReturnsTrue(t *testing.T) {
	s := NewOneTimeUseStore(time.Minute)
	defer s.Close()

	if !s.MarkUsed("sess-1", time.Now().Add(time.Minute)) {
		t.Error("first MarkUsed should return true")
	}
}

func TestOneTimeUseStore_SecondUseSameIDReturnsFalse(t *testing.T) {
	s := NewOneTimeUseStore(time.Minute)
	defer s.Close()

	expiry := time.Now().Add(time.Minute)
	s.MarkUsed("sess-1", expiry)

	if s.MarkUsed("sess-1", expiry) {
		t.Error("second MarkUsed with same ID should return false")
	}
}

func TestOneTimeUseStore_DifferentIDs(t *testing.T) {
	s := NewOneTimeUseStore(time.Minute)
	defer s.Close()

	expiry := time.Now().Add(time.Minute)
	if !s.MarkUsed("sess-1", expiry) {
		t.Error("first MarkUsed(sess-1) should return true")
	}
	if !s.MarkUsed("sess-2", expiry) {
		t.Error("first MarkUsed(sess-2) should return true")
	}
}

func TestOneTimeUseStore_ExpiredEntryAllowsReuse(t *testing.T) {
	// Use a very short cleanup interval.
	s := NewOneTimeUseStore(10 * time.Millisecond)
	defer s.Close()

	// Mark as used with an expiry in the past.
	pastExpiry := time.Now().Add(-time.Second)
	s.MarkUsed("sess-1", pastExpiry)

	// Wait for cleanup to run.
	time.Sleep(50 * time.Millisecond)

	// Should be able to reuse the same session ID.
	if !s.MarkUsed("sess-1", time.Now().Add(time.Minute)) {
		t.Error("MarkUsed after cleanup of expired entry should return true")
	}
}

func TestOneTimeUseStore_ConcurrentAccess(t *testing.T) {
	s := NewOneTimeUseStore(time.Minute)
	defer s.Close()

	const goroutines = 100
	expiry := time.Now().Add(time.Minute)

	var successes atomic.Int64
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := range goroutines {
		go func(idx int) {
			defer wg.Done()
			if s.MarkUsed("sess-race", expiry) {
				successes.Add(1)
			}
		}(i)
	}

	wg.Wait()

	if got := successes.Load(); got != 1 {
		t.Errorf("expected exactly 1 success, got %d", got)
	}
}

func TestOneTimeUseStore_ConcurrentDifferentIDs(t *testing.T) {
	s := NewOneTimeUseStore(time.Minute)
	defer s.Close()

	const goroutines = 100
	expiry := time.Now().Add(time.Minute)

	var successes atomic.Int64
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := range goroutines {
		go func(idx int) {
			defer wg.Done()
			if s.MarkUsed(fmt.Sprintf("sess-%d", idx), expiry) {
				successes.Add(1)
			}
		}(i)
	}

	wg.Wait()

	if got := successes.Load(); got != int64(goroutines) {
		t.Errorf("expected %d successes for unique IDs, got %d", goroutines, got)
	}
}
