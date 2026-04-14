package tunnelauth

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

const (
	opNewProxy     = "NewProxy"
	metaResourceID = "resource_id"
)

// FRP server plugin protocol types.
// These mirror github.com/fatedier/frp/pkg/plugin/server but are defined
// locally to avoid importing FRP's internal packages.

type pluginRequest struct {
	Version string          `json:"version"`
	Op      string          `json:"op"`
	Content json.RawMessage `json:"content"`
}

type pluginResponse struct {
	Reject       bool   `json:"reject"`
	RejectReason string `json:"reject_reason,omitempty"`
	Unchange     bool   `json:"unchange"`
}

type newProxyContent struct {
	User      userInfo          `json:"user"`
	ProxyName string            `json:"proxy_name"`
	ProxyType string            `json:"proxy_type"`
	SubDomain string            `json:"subdomain"`
	Metas     map[string]string `json:"metas"`
}

type userInfo struct {
	User  string            `json:"user"`
	Metas map[string]string `json:"metas"`
	RunID string            `json:"run_id"`
}

// Handler serves the FRP server plugin HTTP callback for NewProxy events.
// It validates tunnel registrations via the Authorizer before allowing
// FRP to accept the proxy.
type Handler struct {
	authorizer *Authorizer
	logger     *slog.Logger
}

// NewHandler creates a handler for the FRP server plugin endpoint.
func NewHandler(authorizer *Authorizer, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{
		authorizer: authorizer,
		logger:     logger.With("component", "tunnelauth"),
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req pluginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.logger.Error("malformed plugin request", "error", err)
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	if req.Op != opNewProxy {
		h.writeJSON(w, &pluginResponse{Reject: false, Unchange: true})
		return
	}

	var content newProxyContent
	if err := json.Unmarshal(req.Content, &content); err != nil {
		h.logger.Error("malformed NewProxy content", "error", err)
		h.writeJSON(w, &pluginResponse{
			Reject:       true,
			RejectReason: "malformed proxy registration",
		})
		return
	}

	resourceID := extractResourceID(content)
	if resourceID == "" {
		h.logger.Warn("no resource ID in proxy registration",
			"proxy_name", content.ProxyName,
		)
		h.writeJSON(w, &pluginResponse{
			Reject:       true,
			RejectReason: "missing resource ID",
		})
		return
	}

	connectorID := content.User.RunID

	err := h.authorizer.AuthorizeTunnel(r.Context(), resourceID, connectorID)
	if err != nil {
		h.logger.Warn("rejected",
			"resource_id", resourceID,
			"connector_id", connectorID,
			"proxy_name", content.ProxyName,
			"reason", err.Error(),
		)
		h.writeJSON(w, &pluginResponse{
			Reject:       true,
			RejectReason: err.Error(),
		})
		return
	}

	h.writeJSON(w, &pluginResponse{Reject: false, Unchange: true})
}

// extractResourceID extracts the resource ID from a NewProxy content.
// Priority: metas["resource_id"] > subdomain > proxy name.
func extractResourceID(c newProxyContent) string {
	if rid, ok := c.Metas[metaResourceID]; ok && rid != "" {
		return rid
	}
	if c.SubDomain != "" {
		return c.SubDomain
	}
	return c.ProxyName
}

func (h *Handler) writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		h.logger.Error("failed to write response", "error", err)
	}
}
