package audit

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	defaultBufferSize = 4096
	flushInterval     = 1 * time.Second
	flushBytes        = 64 * 1024 // 64 KB
)

// Logger is the audit logging interface.
type Logger interface {
	Log(entry Entry)
	Close() error
}

// NopLogger is a no-op logger for testing or when audit is disabled.
type NopLogger struct{}

func (NopLogger) Log(Entry)    {}
func (NopLogger) Close() error { return nil }

// LoggerConfig configures a JSONLLogger.
type LoggerConfig struct {
	FilePath   string
	BufferSize int // channel buffer size; 0 means defaultBufferSize
	MachineID  string
	Version    string
}

// JSONLLogger writes audit entries as newline-delimited JSON to a file.
// It is safe for concurrent use from multiple goroutines.
type JSONLLogger struct {
	ch        chan Entry
	file      *os.File
	done      chan struct{}
	closeOnce sync.Once
	machineID string
	version   string
}

// NewJSONLLogger creates a new JSONL audit logger. It creates parent
// directories if they do not exist, opens the file for append, and starts
// a background goroutine that drains the entry channel to disk.
func NewJSONLLogger(cfg LoggerConfig) (*JSONLLogger, error) {
	if cfg.FilePath == "" {
		return nil, fmt.Errorf("audit: FilePath is required")
	}

	// Create parent directories.
	dir := filepath.Dir(cfg.FilePath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("audit: create directories: %w", err)
	}

	f, err := os.OpenFile(cfg.FilePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, fmt.Errorf("audit: open file: %w", err)
	}

	bufSize := cfg.BufferSize
	if bufSize <= 0 {
		bufSize = defaultBufferSize
	}

	l := &JSONLLogger{
		ch:        make(chan Entry, bufSize),
		file:      f,
		done:      make(chan struct{}),
		machineID: cfg.MachineID,
		version:   cfg.Version,
	}

	go l.run()
	return l, nil
}

// Log enqueues an entry for async writing. It stamps MachineID, ProxyVersion,
// and Timestamp onto the entry. If the internal buffer is full the entry is
// dropped and a warning is printed to stderr.
func (l *JSONLLogger) Log(entry Entry) {
	entry.MachineID = l.machineID
	entry.ProxyVersion = l.version
	entry.Timestamp = time.Now().UTC()

	select {
	case l.ch <- entry:
	default:
		fmt.Fprintf(os.Stderr, "audit: buffer full, dropping entry event=%s action=%s\n", entry.Event, entry.Action)
	}
}

// Close signals the background goroutine to stop, waits for it to drain
// all remaining entries, and closes the underlying file.
func (l *JSONLLogger) Close() error {
	var err error
	l.closeOnce.Do(func() {
		close(l.ch)
		<-l.done
		err = l.file.Close()
	})
	return err
}

// run is the background goroutine that reads entries from the channel,
// JSON-encodes them, and writes them to the buffered file writer. It
// flushes periodically or when the buffer exceeds flushBytes.
func (l *JSONLLogger) run() {
	defer close(l.done)

	bw := bufio.NewWriterSize(l.file, flushBytes)
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()

	enc := json.NewEncoder(bw)

	for {
		select {
		case entry, ok := <-l.ch:
			if !ok {
				// Channel closed — drain is complete.
				_ = bw.Flush()
				return
			}
			_ = enc.Encode(entry)
			if bw.Buffered() >= flushBytes {
				_ = bw.Flush()
			}
		case <-ticker.C:
			_ = bw.Flush()
		}
	}
}
