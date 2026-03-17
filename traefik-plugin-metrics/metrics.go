// Package traefik_plugin_metrics is a Traefik middleware plugin that exposes
// application-level metrics via structured logs and a JSON endpoint.
// Since Traefik plugins run in Yaegi (Go interpreter) and cannot import
// Prometheus, we use atomic counters + a mutex-guarded ring-buffer histogram.
package traefik_plugin_metrics

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"math"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ---------- Configuration ----------

const defaultMetricsPath = "/.well-known/nhp-metrics"

// Config holds the plugin configuration set in provider.toml.
type Config struct {
	MetricsPath        string   `json:"metricsPath"`
	LogIntervalSeconds int      `json:"logIntervalSeconds"`
	AllowedCIDRs       []string `json:"allowedCIDRs"`
}

// CreateConfig populates a default Config.
func CreateConfig() *Config {
	return &Config{
		MetricsPath:        defaultMetricsPath,
		LogIntervalSeconds: 60,
	}
}

// ---------- Ring-buffer histogram ----------

// Histogram collects duration samples in a fixed-size ring buffer and
// computes percentiles over the rolling window. Record() and sortedSnapshot()
// are both guarded by a mutex.
type Histogram struct {
	mu      sync.Mutex
	samples []float64
	pos     int
	full    bool
}

func newHistogram(capacity int) *Histogram {
	return &Histogram{
		samples: make([]float64, capacity),
	}
}

// Record adds a duration sample (in milliseconds) to the ring buffer.
func (h *Histogram) Record(ms float64) {
	h.mu.Lock()
	h.samples[h.pos] = ms
	h.pos++
	if h.pos >= len(h.samples) {
		h.pos = 0
		h.full = true
	}
	h.mu.Unlock()
}

// sortedSnapshot copies the current samples under lock and returns
// them sorted. Callers can then read multiple percentiles without
// re-sorting.
func (h *Histogram) sortedSnapshot() []float64 {
	h.mu.Lock()
	n := h.pos
	if h.full {
		n = len(h.samples)
	}
	if n == 0 {
		h.mu.Unlock()
		return nil
	}
	buf := make([]float64, n)
	if h.full {
		copy(buf, h.samples)
	} else {
		copy(buf, h.samples[:n])
	}
	h.mu.Unlock()

	sort.Float64s(buf)
	return buf
}

// percentileFromSorted reads a percentile from an already-sorted slice.
func percentileFromSorted(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(math.Ceil(p/100*float64(len(sorted)))) - 1
	if idx < 0 {
		idx = 0
	}
	return sorted[idx]
}

// ---------- CIDR allowlist ----------

func parseCIDRs(cidrs []string) []*net.IPNet {
	var nets []*net.IPNet
	for _, cidr := range cidrs {
		_, ipNet, err := net.ParseCIDR(cidr)
		if err != nil {
			// Try as plain IP by appending /32 or /128.
			ip := net.ParseIP(cidr)
			if ip == nil {
				log.Printf("[nhp-metrics] invalid CIDR/IP in allowedCIDRs: %q", cidr)
				continue
			}
			bits := 32
			if ip.To4() == nil {
				bits = 128
			}
			ipNet = &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)}
		}
		nets = append(nets, ipNet)
	}
	return nets
}

func isAllowed(remoteAddr string, allowedNets []*net.IPNet) bool {
	if len(allowedNets) == 0 {
		return true // no allowlist = allow all
	}
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	for _, n := range allowedNets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// ---------- Metrics store ----------

// Metrics holds all atomic counters and the request duration histogram.
type Metrics struct {
	// Request counters
	RequestTotal    atomic.Int64
	InFlightGauge   atomic.Int64

	// Proxy type counters
	ProxyStandard   atomic.Int64
	ProxyStreaming   atomic.Int64
	ProxyWebSocket  atomic.Int64
	WebSocketActive atomic.Int64

	// Error counters
	ErrorBackendConnect atomic.Int64
	ErrorBackendTimeout atomic.Int64
	ErrorUnauthorized   atomic.Int64
	ErrorPanic          atomic.Int64

	// Status code counters
	Status2xx atomic.Int64
	Status3xx atomic.Int64
	Status4xx atomic.Int64
	Status5xx atomic.Int64

	// Histogram (rolling window of 10 000 samples)
	RequestDuration *Histogram
}

func newMetrics() *Metrics {
	return &Metrics{
		RequestDuration: newHistogram(10000),
	}
}

// snapshot returns a JSON-serialisable map of all current values.
func (m *Metrics) snapshot() map[string]interface{} {
	reqDur := m.RequestDuration.sortedSnapshot()

	return map[string]interface{}{
		"request_total":          m.RequestTotal.Load(),
		"in_flight":             m.InFlightGauge.Load(),
		"proxy_standard":        m.ProxyStandard.Load(),
		"proxy_streaming":       m.ProxyStreaming.Load(),
		"proxy_websocket":       m.ProxyWebSocket.Load(),
		"websocket_active":      m.WebSocketActive.Load(),
		"error_backend_connect": m.ErrorBackendConnect.Load(),
		"error_backend_timeout": m.ErrorBackendTimeout.Load(),
		"error_unauthorized":    m.ErrorUnauthorized.Load(),
		"error_panic":           m.ErrorPanic.Load(),
		"status_2xx":            m.Status2xx.Load(),
		"status_3xx":            m.Status3xx.Load(),
		"status_4xx":            m.Status4xx.Load(),
		"status_5xx":            m.Status5xx.Load(),
		"request_duration_p50_ms": percentileFromSorted(reqDur, 50),
		"request_duration_p95_ms": percentileFromSorted(reqDur, 95),
		"request_duration_p99_ms": percentileFromSorted(reqDur, 99),
	}
}

// ---------- Structured log emitter ----------

func (m *Metrics) startLogEmitter(ctx context.Context, intervalSeconds int) {
	if intervalSeconds <= 0 {
		return
	}
	ticker := time.NewTicker(time.Duration(intervalSeconds) * time.Second)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				data, err := json.Marshal(m.snapshot())
				if err != nil {
					log.Printf("[nhp-metrics] marshal error: %v", err)
					continue
				}
				log.Printf("[nhp-metrics] metrics_snapshot %s", string(data))
			}
		}
	}()
}

// ---------- Response writer wrapper ----------

type wrappedWriter struct {
	http.ResponseWriter
	statusCode int
	written    bool
}

func (w *wrappedWriter) WriteHeader(code int) {
	if w.written {
		return
	}
	w.statusCode = code
	w.written = true
	w.ResponseWriter.WriteHeader(code)
}

func (w *wrappedWriter) Write(b []byte) (int, error) {
	if !w.written {
		w.statusCode = http.StatusOK
		w.written = true
	}
	return w.ResponseWriter.Write(b)
}

// Flush delegates to the underlying ResponseWriter if it implements
// http.Flusher. Required for SSE / streaming responses.
func (w *wrappedWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack delegates to the underlying ResponseWriter if it implements
// http.Hijacker. Required for WebSocket upgrades.
func (w *wrappedWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if h, ok := w.ResponseWriter.(http.Hijacker); ok {
		return h.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}

// ---------- Plugin (Traefik middleware) ----------

// NHPMetrics is the Traefik middleware handler.
type NHPMetrics struct {
	next        http.Handler
	name        string
	metricsPath string
	metrics     *Metrics
	cancel      context.CancelFunc
	allowedNets []*net.IPNet
}

// New creates and returns a new NHPMetrics middleware instance.
func New(_ context.Context, next http.Handler, config *Config, name string) (http.Handler, error) {
	ctx, cancel := context.WithCancel(context.Background())

	m := newMetrics()
	m.startLogEmitter(ctx, config.LogIntervalSeconds)

	path := config.MetricsPath
	if path == "" {
		path = defaultMetricsPath
	}

	return &NHPMetrics{
		next:        next,
		name:        name,
		metricsPath: path,
		metrics:     m,
		cancel:      cancel,
		allowedNets: parseCIDRs(config.AllowedCIDRs),
	}, nil
}

// Close cancels the log emitter goroutine. Traefik calls this on config
// reload when the old middleware instance is replaced.
func (n *NHPMetrics) Close() error {
	n.cancel()
	return nil
}

func (n *NHPMetrics) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Serve JSON metrics endpoint (gated by IP allowlist)
	if r.URL.Path == n.metricsPath {
		if !isAllowed(r.RemoteAddr, n.allowedNets) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(n.metrics.snapshot())
		return
	}

	start := time.Now()
	n.metrics.RequestTotal.Add(1)
	n.metrics.InFlightGauge.Add(1)
	defer n.metrics.InFlightGauge.Add(-1)

	// Detect proxy type from request
	if isWebSocketUpgrade(r) {
		n.metrics.ProxyWebSocket.Add(1)
		n.metrics.WebSocketActive.Add(1)
		defer n.metrics.WebSocketActive.Add(-1)
	} else if isStreamingRequest(r) {
		n.metrics.ProxyStreaming.Add(1)
	} else {
		n.metrics.ProxyStandard.Add(1)
	}

	// Wrap response writer to capture status code
	wrapped := &wrappedWriter{ResponseWriter: w, statusCode: http.StatusOK}

	// Panic recovery — also records duration and status so counters stay
	// consistent with request_total.
	defer func() {
		elapsed := float64(time.Since(start).Milliseconds())
		n.metrics.RequestDuration.Record(elapsed)

		if rec := recover(); rec != nil {
			n.metrics.ErrorPanic.Add(1)
			n.metrics.Status5xx.Add(1)
			log.Printf("[nhp-metrics] panic recovered: %v", rec)
			if !wrapped.written {
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
			return
		}

		// Bucket status codes (normal path)
		n.recordStatusCode(wrapped.statusCode)
	}()

	n.next.ServeHTTP(wrapped, r)
}

// recordStatusCode increments the appropriate status and error counters.
func (n *NHPMetrics) recordStatusCode(code int) {
	switch {
	case code >= 200 && code < 300:
		n.metrics.Status2xx.Add(1)
	case code >= 300 && code < 400:
		n.metrics.Status3xx.Add(1)
	case code >= 400 && code < 500:
		n.metrics.Status4xx.Add(1)
		if code == http.StatusUnauthorized || code == http.StatusForbidden {
			n.metrics.ErrorUnauthorized.Add(1)
		}
	case code >= 500:
		n.metrics.Status5xx.Add(1)
		if code == http.StatusBadGateway || code == http.StatusServiceUnavailable {
			n.metrics.ErrorBackendConnect.Add(1)
		}
		if code == http.StatusGatewayTimeout {
			n.metrics.ErrorBackendTimeout.Add(1)
		}
	}
}

// ---------- Helpers ----------

func isWebSocketUpgrade(r *http.Request) bool {
	conn := strings.ToLower(r.Header.Get("Connection"))
	if !strings.Contains(conn, "upgrade") {
		return false
	}
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}

func isStreamingRequest(r *http.Request) bool {
	accept := r.Header.Get("Accept")
	return strings.Contains(accept, "text/event-stream") ||
		strings.Contains(accept, "application/x-ndjson")
}
