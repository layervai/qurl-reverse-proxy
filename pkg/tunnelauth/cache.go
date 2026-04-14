package tunnelauth

import (
	"log/slog"
	"sync"
	"time"
)

type cacheEntry struct {
	ConnectorID string
	ValidatedAt time.Time
	ExpiresAt   time.Time
}

// ResourceCache is a TTL-based cache for recently validated resource IDs.
// It follows the same pattern as middleware.OneTimeUseStore: background
// ticker for eviction, sync.RWMutex for concurrent access, closeCh for
// graceful shutdown.
type ResourceCache struct {
	mu      sync.RWMutex
	entries map[string]cacheEntry // keyed by resourceID
	ttl     time.Duration
	maxSize int
	closeCh chan struct{}
	logger  *slog.Logger
	now     func() time.Time // for testing
}

func newResourceCache(ttl, cleanupInterval time.Duration, maxSize int, logger *slog.Logger) *ResourceCache {
	c := &ResourceCache{
		entries: make(map[string]cacheEntry),
		ttl:     ttl,
		maxSize: maxSize,
		closeCh: make(chan struct{}),
		logger:  logger,
		now:     time.Now,
	}
	go c.cleanup(cleanupInterval)
	return c
}

func (c *ResourceCache) Get(resourceID string) (cacheEntry, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.entries[resourceID]
	if !ok {
		return cacheEntry{}, false
	}
	if c.now().After(entry.ExpiresAt) {
		return cacheEntry{}, false
	}
	return entry, true
}

// Put stores a validated resource. If the cache is at capacity and the
// resourceID is not already present, the insert is dropped.
func (c *ResourceCache) Put(resourceID, connectorID string) {
	now := c.now()

	c.mu.Lock()
	defer c.mu.Unlock()

	if len(c.entries) >= c.maxSize {
		if _, exists := c.entries[resourceID]; !exists {
			c.logger.Warn("cache at capacity, dropping insert",
				"max_size", c.maxSize,
				"resource_id", resourceID,
			)
			return
		}
	}

	c.entries[resourceID] = cacheEntry{
		ConnectorID: connectorID,
		ValidatedAt: now,
		ExpiresAt:   now.Add(c.ttl),
	}
}

func (c *ResourceCache) Invalidate(resourceID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, resourceID)
}

func (c *ResourceCache) Close() {
	close(c.closeCh)
}

func (c *ResourceCache) cleanup(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-c.closeCh:
			return
		case <-ticker.C:
			c.purgeExpired()
		}
	}
}

func (c *ResourceCache) purgeExpired() {
	now := c.now()

	c.mu.Lock()
	defer c.mu.Unlock()

	for id, entry := range c.entries {
		if now.After(entry.ExpiresAt) {
			delete(c.entries, id)
		}
	}
}
