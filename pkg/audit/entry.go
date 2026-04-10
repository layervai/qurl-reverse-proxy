package audit

import "time"

// Action describes the outcome of an access attempt.
type Action string

const (
	ActionAllow                Action = "allow"
	ActionDenyNoSession        Action = "deny_no_session"
	ActionDenyInvalidSignature Action = "deny_invalid_signature"
	ActionDenyExpired          Action = "deny_expired"
	ActionDenyUnknownResource  Action = "deny_unknown_resource"
	ActionDenyOneTimeConsumed  Action = "deny_one_time_consumed"
	ActionDenyRateLimited      Action = "deny_rate_limited"
	ActionDenyIPPolicy         Action = "deny_ip_policy"
	ActionDenyMalformed        Action = "deny_malformed"
	ActionDenyMissingClaims    Action = "deny_missing_claims"
	ActionError                Action = "error"
)

// Entry is a single audit log record.
type Entry struct {
	Timestamp    time.Time `json:"ts"`
	Event        string    `json:"event"`
	Action       Action    `json:"action"`
	SessionID    string    `json:"session_id,omitempty"`
	ResourceID   string    `json:"resource_id,omitempty"`
	RouteID      string    `json:"route_id,omitempty"`
	Subject      string    `json:"subject,omitempty"`
	SourceIP     string    `json:"source_ip"`
	SourcePort   int       `json:"source_port,omitempty"`
	Target       string    `json:"target,omitempty"`
	TunnelType   string    `json:"tunnel_type,omitempty"`
	LatencyMS    float64   `json:"latency_ms,omitempty"`
	BytesSent    int64     `json:"bytes_sent,omitempty"`
	BytesRecv    int64     `json:"bytes_received,omitempty"`
	Error        string    `json:"error,omitempty"`
	MachineID    string    `json:"machine_id"`
	ProxyVersion string    `json:"proxy_version"`
}
