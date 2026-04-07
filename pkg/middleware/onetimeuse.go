package middleware

import (
	"sync"
	"time"
)

// OneTimeUseStore tracks session IDs that have been consumed,
// preventing replay of one-time-use tokens.
type OneTimeUseStore struct {
	mu      sync.RWMutex
	used    map[string]time.Time // session_id -> expiry
	closeCh chan struct{}
}

// NewOneTimeUseStore creates a store that periodically purges expired entries.
// A cleanupInterval of 0 defaults to 30 seconds.
func NewOneTimeUseStore(cleanupInterval time.Duration) *OneTimeUseStore {
	if cleanupInterval == 0 {
		cleanupInterval = 30 * time.Second
	}

	s := &OneTimeUseStore{
		used:    make(map[string]time.Time),
		closeCh: make(chan struct{}),
	}

	go s.cleanup(cleanupInterval)

	return s
}

// MarkUsed atomically checks whether sessionID has already been consumed.
// It returns true if this is the first use (the entry was inserted),
// or false if the session was already present.
func (s *OneTimeUseStore) MarkUsed(sessionID string, expiry time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.used[sessionID]; exists {
		return false
	}

	s.used[sessionID] = expiry
	return true
}

// Close stops the background cleanup goroutine.
func (s *OneTimeUseStore) Close() {
	close(s.closeCh)
}

func (s *OneTimeUseStore) cleanup(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-s.closeCh:
			return
		case <-ticker.C:
			s.purgeExpired()
		}
	}
}

func (s *OneTimeUseStore) purgeExpired() {
	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()

	for id, expiry := range s.used {
		if now.After(expiry) {
			delete(s.used, id)
		}
	}
}
