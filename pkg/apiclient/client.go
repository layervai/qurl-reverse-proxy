package apiclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	defaultBaseURL    = "https://api.layerv.ai/v1"
	defaultTimeout    = 30 * time.Second
	defaultMaxRetries = 3
	defaultUserAgent  = "qurl-proxy/dev"
)

// Client is an HTTP client for the QURL API.
type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
	userAgent  string
	maxRetries int
}

// Option configures a Client.
type Option func(*Client)

// New creates a new QURL API client. If baseURL is empty, the default
// (https://api.layerv.ai/v1) is used. token is the Bearer token for
// authentication.
func New(baseURL, token string, opts ...Option) *Client {
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	baseURL = strings.TrimRight(baseURL, "/")

	c := &Client{
		baseURL:    baseURL,
		token:      token,
		httpClient: &http.Client{Timeout: defaultTimeout},
		userAgent:  defaultUserAgent,
		maxRetries: defaultMaxRetries,
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// WithHTTPClient sets the underlying *http.Client.
func WithHTTPClient(c *http.Client) Option {
	return func(client *Client) {
		client.httpClient = c
	}
}

// WithUserAgent sets the User-Agent header value.
func WithUserAgent(ua string) Option {
	return func(c *Client) {
		c.userAgent = ua
	}
}

// WithMaxRetries sets the maximum number of retry attempts for retryable
// responses (429, 5xx). The total number of requests is maxRetries + 1.
func WithMaxRetries(n int) Option {
	return func(c *Client) {
		if n < 0 {
			n = 0
		}
		c.maxRetries = n
	}
}

// WithTimeout sets the HTTP client timeout.
func WithTimeout(d time.Duration) Option {
	return func(c *Client) {
		c.httpClient.Timeout = d
	}
}

// do executes an HTTP request with retries for 429 and 5xx responses.
// method and path are combined with c.baseURL. body is JSON-encoded if
// non-nil. On success (2xx), the response is decoded into result (if
// non-nil). For non-2xx responses, an *APIError is returned.
func (c *Client) do(ctx context.Context, method, path string, body any, result any) error {
	url := c.baseURL + path

	var reqBody []byte
	if body != nil {
		var err error
		reqBody, err = json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request body: %w", err)
		}
	}

	backoffs := []time.Duration{
		500 * time.Millisecond,
		1 * time.Second,
		2 * time.Second,
		4 * time.Second,
	}

	var lastErr error
	attempts := c.maxRetries + 1

	for attempt := range attempts {
		var bodyReader io.Reader
		if reqBody != nil {
			bodyReader = bytes.NewReader(reqBody)
		}

		req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
		if err != nil {
			return fmt.Errorf("create request: %w", err)
		}

		req.Header.Set("Authorization", "Bearer "+c.token)
		req.Header.Set("User-Agent", c.userAgent)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			// Network errors are not retried; they may be context
			// cancellation, timeouts, DNS failures, etc.
			return fmt.Errorf("execute request: %w", err)
		}

		respBody, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return fmt.Errorf("read response body: %w", err)
		}

		// Success path.
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			if result != nil && len(respBody) > 0 {
				if err := json.Unmarshal(respBody, result); err != nil {
					return fmt.Errorf("decode response: %w", err)
				}
			}
			return nil
		}

		// Build the API error from the response.
		apiErr := &APIError{StatusCode: resp.StatusCode}
		// Best-effort decode; if the body isn't JSON we still have the
		// status code.
		_ = json.Unmarshal(respBody, apiErr)
		if apiErr.StatusCode == 0 {
			apiErr.StatusCode = resp.StatusCode
		}
		lastErr = apiErr

		// Decide whether to retry.
		retryable := resp.StatusCode == 429 || resp.StatusCode >= 500
		if !retryable || attempt >= c.maxRetries {
			return lastErr
		}

		// Determine the backoff duration.
		wait := backoffDuration(backoffs, attempt)

		// Respect Retry-After header on 429.
		if resp.StatusCode == 429 {
			if ra := resp.Header.Get("Retry-After"); ra != "" {
				if secs, err := strconv.Atoi(ra); err == nil && secs > 0 {
					wait = time.Duration(secs) * time.Second
				}
			}
		}

		slog.WarnContext(ctx, "retrying request",
			"method", method,
			"path", path,
			"status", resp.StatusCode,
			"attempt", attempt+1,
			"wait", wait,
		)

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
	}

	return lastErr
}

// backoffDuration returns the backoff wait time for the given attempt,
// applying 25% jitter.
func backoffDuration(backoffs []time.Duration, attempt int) time.Duration {
	idx := attempt
	if idx >= len(backoffs) {
		idx = len(backoffs) - 1
	}
	base := backoffs[idx]

	// Apply +/-25% jitter: multiply by [0.75, 1.25).
	jitter := 0.75 + rand.Float64()*0.5
	return time.Duration(float64(base) * jitter)
}
