package tunnelauth

import (
	"log/slog"
	"sync"
	"testing"
	"time"
)

func TestResourceCache_PutAndGet(t *testing.T) {
	c := newResourceCache(time.Minute, time.Minute, 100, slog.Default())
	defer c.Close()

	c.Put("r_abc", "conn_1")

	entry, ok := c.Get("r_abc")
	if !ok {
		t.Fatal("expected cache hit")
	}
	if entry.ConnectorID != "conn_1" {
		t.Errorf("ConnectorID = %q, want %q", entry.ConnectorID, "conn_1")
	}
}

func TestResourceCache_Miss(t *testing.T) {
	c := newResourceCache(time.Minute, time.Minute, 100, slog.Default())
	defer c.Close()

	if _, ok := c.Get("nonexistent"); ok {
		t.Fatal("expected cache miss")
	}
}

func TestResourceCache_ExpiredEntryMiss(t *testing.T) {
	c := newResourceCache(50*time.Millisecond, time.Minute, 100, slog.Default())
	defer c.Close()

	c.Put("r_abc", "conn_1")

	time.Sleep(60 * time.Millisecond)

	if _, ok := c.Get("r_abc"); ok {
		t.Fatal("expected cache miss for expired entry")
	}
}

func TestResourceCache_Invalidate(t *testing.T) {
	c := newResourceCache(time.Minute, time.Minute, 100, slog.Default())
	defer c.Close()

	c.Put("r_abc", "conn_1")
	c.Invalidate("r_abc")

	if _, ok := c.Get("r_abc"); ok {
		t.Fatal("expected cache miss after invalidate")
	}
}

func TestResourceCache_CleanupPurgesExpired(t *testing.T) {
	// Short TTL and short cleanup interval.
	c := newResourceCache(30*time.Millisecond, 20*time.Millisecond, 100, slog.Default())
	defer c.Close()

	c.Put("r_abc", "conn_1")

	// Wait for TTL + cleanup cycle.
	time.Sleep(80 * time.Millisecond)

	c.mu.RLock()
	count := len(c.entries)
	c.mu.RUnlock()

	if count != 0 {
		t.Fatalf("expected 0 entries after cleanup, got %d", count)
	}
}

func TestResourceCache_OverwriteExistingEntry(t *testing.T) {
	c := newResourceCache(time.Minute, time.Minute, 100, slog.Default())
	defer c.Close()

	c.Put("r_abc", "conn_1")
	c.Put("r_abc", "conn_2")

	entry, ok := c.Get("r_abc")
	if !ok {
		t.Fatal("expected cache hit")
	}
	if entry.ConnectorID != "conn_2" {
		t.Errorf("ConnectorID = %q, want %q", entry.ConnectorID, "conn_2")
	}
}

func TestResourceCache_MaxSizeEnforced(t *testing.T) {
	c := newResourceCache(time.Minute, time.Minute, 2, slog.Default())
	defer c.Close()

	c.Put("r_1", "conn_1")
	c.Put("r_2", "conn_2")

	// Third insert for a new key should be dropped.
	c.Put("r_3", "conn_3")

	if _, ok := c.Get("r_3"); ok {
		t.Fatal("expected cache miss for entry beyond maxSize")
	}

	// Existing key can still be updated.
	c.Put("r_1", "conn_updated")
	entry, ok := c.Get("r_1")
	if !ok {
		t.Fatal("expected cache hit for existing key update at capacity")
	}
	if entry.ConnectorID != "conn_updated" {
		t.Errorf("ConnectorID = %q, want %q", entry.ConnectorID, "conn_updated")
	}
}

func TestResourceCache_ConcurrentAccess(t *testing.T) {
	c := newResourceCache(time.Minute, time.Minute, 10000, slog.Default())
	defer c.Close()

	var wg sync.WaitGroup
	for i := range 50 {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			rid := "r_" + string(rune('a'+id%26))
			c.Put(rid, "conn")
			c.Get(rid)
			c.Invalidate(rid)
		}(i)
	}
	wg.Wait()
}
