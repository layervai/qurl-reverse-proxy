package apiclient

import (
	"context"
	"fmt"
)

// HeartbeatRequest is the payload for a connector heartbeat.
type HeartbeatRequest struct {
	ConnectorID string `json:"connector_id"`
	MachineID   string `json:"machine_id"`
	Uptime      int64  `json:"uptime_seconds"`
}

// Heartbeat sends a connector heartbeat to the API.
func (c *Client) Heartbeat(ctx context.Context, req *HeartbeatRequest) error {
	if err := c.do(ctx, "POST", "/connectors/heartbeat", req, nil); err != nil {
		return fmt.Errorf("heartbeat: %w", err)
	}
	return nil
}
