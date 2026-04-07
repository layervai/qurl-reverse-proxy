package apiclient

import (
	"context"
	"fmt"
	"time"
)

// Resource represents a QURL-protected resource.
type Resource struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	TargetURL   string    `json:"target_url"`
	Type        string    `json:"type"` // http, tcp, ssh
	Status      string    `json:"status"`
	ConnectorID string    `json:"connector_id,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// CreateResourceRequest is the payload for creating a new resource.
type CreateResourceRequest struct {
	Name      string `json:"name"`
	TargetURL string `json:"target_url"`
	Type      string `json:"type"`
}

// ListResourcesResponse is the response for listing resources.
type ListResourcesResponse struct {
	Resources []Resource `json:"resources"`
	Total     int        `json:"total"`
}

// ListResources returns all resources visible to the authenticated client.
func (c *Client) ListResources(ctx context.Context) (*ListResourcesResponse, error) {
	var resp ListResourcesResponse
	if err := c.do(ctx, "GET", "/resources", nil, &resp); err != nil {
		return nil, fmt.Errorf("list resources: %w", err)
	}
	return &resp, nil
}

// GetResource returns a single resource by ID.
func (c *Client) GetResource(ctx context.Context, id string) (*Resource, error) {
	var resp Resource
	if err := c.do(ctx, "GET", "/resources/"+id, nil, &resp); err != nil {
		return nil, fmt.Errorf("get resource %s: %w", id, err)
	}
	return &resp, nil
}

// CreateResource creates a new resource.
func (c *Client) CreateResource(ctx context.Context, req *CreateResourceRequest) (*Resource, error) {
	var resp Resource
	if err := c.do(ctx, "POST", "/resources", req, &resp); err != nil {
		return nil, fmt.Errorf("create resource: %w", err)
	}
	return &resp, nil
}

// DeleteResource deletes a resource by ID.
func (c *Client) DeleteResource(ctx context.Context, id string) error {
	if err := c.do(ctx, "DELETE", "/resources/"+id, nil, nil); err != nil {
		return fmt.Errorf("delete resource %s: %w", id, err)
	}
	return nil
}
