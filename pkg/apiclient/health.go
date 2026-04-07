package apiclient

import (
	"context"
	"fmt"
)

// HealthStatus represents the API health check response.
type HealthStatus struct {
	Status  string `json:"status"`
	Version string `json:"version,omitempty"`
}

// Health checks the API server health.
func (c *Client) Health(ctx context.Context) (*HealthStatus, error) {
	var resp HealthStatus
	if err := c.do(ctx, "GET", "/health", nil, &resp); err != nil {
		return nil, fmt.Errorf("health check: %w", err)
	}
	return &resp, nil
}
