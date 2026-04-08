package audit

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func tempFilePath(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "audit.jsonl")
}

func readLines(t *testing.T, path string) []string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	defer func() { _ = f.Close() }()
	var lines []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("scan %s: %v", path, err)
	}
	return lines
}

func TestJSONLLogger_SingleEntry(t *testing.T) {
	path := tempFilePath(t)
	l, err := NewJSONLLogger(LoggerConfig{
		FilePath:  path,
		MachineID: "m-001",
		Version:   "v1.0.0",
	})
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}

	l.Log(Entry{
		Event:    "proxy.access",
		Action:   ActionAllow,
		SourceIP: "10.0.0.1",
	})

	if err := l.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	lines := readLines(t, path)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}

	var e Entry
	if err := json.Unmarshal([]byte(lines[0]), &e); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if e.Event != "proxy.access" {
		t.Errorf("event = %q, want %q", e.Event, "proxy.access")
	}
	if e.Action != ActionAllow {
		t.Errorf("action = %q, want %q", e.Action, ActionAllow)
	}
	if e.SourceIP != "10.0.0.1" {
		t.Errorf("source_ip = %q, want %q", e.SourceIP, "10.0.0.1")
	}
	if e.MachineID != "m-001" {
		t.Errorf("machine_id = %q, want %q", e.MachineID, "m-001")
	}
	if e.ProxyVersion != "v1.0.0" {
		t.Errorf("proxy_version = %q, want %q", e.ProxyVersion, "v1.0.0")
	}
	if e.Timestamp.IsZero() {
		t.Error("timestamp is zero")
	}
}

func TestJSONLLogger_MultipleEntries(t *testing.T) {
	path := tempFilePath(t)
	l, err := NewJSONLLogger(LoggerConfig{
		FilePath:  path,
		MachineID: "m-multi",
		Version:   "v2.0.0",
	})
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}

	const perGoroutine = 10
	const goroutines = 10
	const total = perGoroutine * goroutines

	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < perGoroutine; i++ {
				l.Log(Entry{
					Event:    "proxy.access",
					Action:   ActionAllow,
					SourceIP: "10.0.0.1",
				})
			}
		}()
	}
	wg.Wait()

	if err := l.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	lines := readLines(t, path)
	if len(lines) != total {
		t.Fatalf("expected %d lines, got %d", total, len(lines))
	}

	for i, line := range lines {
		var e Entry
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			t.Errorf("line %d: unmarshal: %v", i, err)
		}
	}
}

func TestJSONLLogger_StampsMachineFields(t *testing.T) {
	path := tempFilePath(t)
	l, err := NewJSONLLogger(LoggerConfig{
		FilePath:  path,
		MachineID: "stamped-id",
		Version:   "v3.0.0",
	})
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}

	// Log entry with empty machine fields — logger must stamp them.
	l.Log(Entry{
		Event:    "proxy.access",
		Action:   ActionDenyExpired,
		SourceIP: "192.168.1.1",
	})

	if err := l.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	lines := readLines(t, path)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}

	var e Entry
	if err := json.Unmarshal([]byte(lines[0]), &e); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if e.MachineID != "stamped-id" {
		t.Errorf("machine_id = %q, want %q", e.MachineID, "stamped-id")
	}
	if e.ProxyVersion != "v3.0.0" {
		t.Errorf("proxy_version = %q, want %q", e.ProxyVersion, "v3.0.0")
	}
}

func TestJSONLLogger_DrainOnClose(t *testing.T) {
	path := tempFilePath(t)
	l, err := NewJSONLLogger(LoggerConfig{
		FilePath:  path,
		MachineID: "drain",
		Version:   "v1.0.0",
	})
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}

	const total = 50
	for i := 0; i < total; i++ {
		l.Log(Entry{
			Event:    "proxy.access",
			Action:   ActionAllow,
			SourceIP: "10.0.0.1",
		})
	}

	// Close immediately — must drain all buffered entries.
	if err := l.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	lines := readLines(t, path)
	if len(lines) != total {
		t.Fatalf("expected %d lines, got %d", total, len(lines))
	}
}

func TestJSONLLogger_TimestampFormat(t *testing.T) {
	path := tempFilePath(t)
	l, err := NewJSONLLogger(LoggerConfig{
		FilePath:  path,
		MachineID: "ts",
		Version:   "v1.0.0",
	})
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}

	before := time.Now().UTC()
	l.Log(Entry{
		Event:    "proxy.access",
		Action:   ActionAllow,
		SourceIP: "10.0.0.1",
	})
	if err := l.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	after := time.Now().UTC()

	lines := readLines(t, path)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}

	// Extract raw ts value from JSON.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(lines[0]), &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	var tsStr string
	if err := json.Unmarshal(raw["ts"], &tsStr); err != nil {
		t.Fatalf("unmarshal ts: %v", err)
	}

	// Must parse as RFC3339Nano.
	ts, err := time.Parse(time.RFC3339Nano, tsStr)
	if err != nil {
		t.Fatalf("parse ts %q as RFC3339Nano: %v", tsStr, err)
	}

	if ts.Location() != time.UTC {
		t.Errorf("timestamp location = %v, want UTC", ts.Location())
	}
	if ts.Before(before) || ts.After(after) {
		t.Errorf("timestamp %v not between %v and %v", ts, before, after)
	}
}

func TestJSONLLogger_CreatesParentDirs(t *testing.T) {
	base := t.TempDir()
	path := filepath.Join(base, "a", "b", "c", "audit.jsonl")

	l, err := NewJSONLLogger(LoggerConfig{
		FilePath:  path,
		MachineID: "dirs",
		Version:   "v1.0.0",
	})
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}

	l.Log(Entry{
		Event:    "proxy.access",
		Action:   ActionAllow,
		SourceIP: "10.0.0.1",
	})

	if err := l.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("file not created at %s: %v", path, err)
	}

	lines := readLines(t, path)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
}

func TestNopLogger_Safe(t *testing.T) {
	var l NopLogger
	// Must not panic.
	l.Log(Entry{Event: "test", Action: ActionAllow, SourceIP: "1.2.3.4"})
	if err := l.Close(); err != nil {
		t.Fatalf("NopLogger.Close returned error: %v", err)
	}
}
