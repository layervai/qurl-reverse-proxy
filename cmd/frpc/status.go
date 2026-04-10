package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	nhpconfig "github.com/layervai/qurl-reverse-proxy/pkg/config"
)

var statusJSON bool

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show proxy tunnel status",
	RunE:  runStatus,
}

func init() {
	statusCmd.Flags().BoolVar(&statusJSON, "json", false, "output status in JSON format")
}

// adminProxyStatus represents a single proxy status from the FRP admin API.
type adminProxyStatus struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Status     string `json:"status"`
	Err        string `json:"err"`
	LocalAddr  string `json:"local_addr"`
	RemoteAddr string `json:"remote_addr"`
}

// statusOutput is the structured output for --json mode.
type statusOutput struct {
	Running bool                      `json:"running"`
	Proxies map[string][]adminProxyStatus `json:"proxies,omitempty"`
	Routes  []routeStatus             `json:"routes,omitempty"`
}

type routeStatus struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Target     string `json:"target"`
	ResourceID string `json:"resource_id,omitempty"`
	Status     string `json:"status"`
	RemoteAddr string `json:"remote_addr,omitempty"`
}

func runStatus(_ *cobra.Command, _ []string) error {
	machineID := getMachineID()

	// Try to reach the FRP admin API
	adminURL := "http://127.0.0.1:7400/api/status"
	req, err := http.NewRequest("GET", adminURL, nil)
	if err != nil {
		return fmt.Errorf("creating request: %w", err)
	}
	req.SetBasicAuth("admin", machineID)

	httpClient := &http.Client{Timeout: 3 * time.Second}
	resp, err := httpClient.Do(req)

	var proxyMap map[string][]adminProxyStatus
	running := false

	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			running = true
			body, readErr := io.ReadAll(resp.Body)
			if readErr == nil {
				_ = json.Unmarshal(body, &proxyMap)
			}
		}
	}

	// Load config to show configured routes
	cfgPath, isLegacy, discoverErr := nhpconfig.Discover(cfgFile)
	var cfg *nhpconfig.Config
	if discoverErr == nil && !isLegacy {
		cfg, _ = nhpconfig.Load(cfgPath)
	}

	// Build route status by merging config with live proxy status
	var routes []routeStatus
	if cfg != nil {
		proxyLookup := buildProxyLookup(proxyMap)
		for _, r := range cfg.Routes {
			rs := routeStatus{
				Name:       r.Name,
				Type:       string(r.Type),
				Target:     fmt.Sprintf("%s:%d", r.LocalIP, r.LocalPort),
				ResourceID: r.ResourceID,
				Status:     "not running",
			}
			if ps, ok := proxyLookup[r.Name]; ok {
				rs.Status = ps.Status
				rs.RemoteAddr = ps.RemoteAddr
				if ps.Err != "" {
					rs.Status = "error: " + ps.Err
				}
			} else if !running {
				rs.Status = "tunnel offline"
			}
			routes = append(routes, rs)
		}
	}

	if statusJSON {
		out := statusOutput{
			Running: running,
			Proxies: proxyMap,
			Routes:  routes,
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(out)
	}

	// Human-readable output
	fmt.Printf("\n%sTunnel Status%s\n", colorBold, colorReset)
	if running {
		fmt.Printf("  Service:  %srunning%s\n", colorGreen, colorReset)
		fmt.Printf("  Admin:    http://127.0.0.1:7400\n")
	} else {
		fmt.Printf("  Service:  %snot running%s\n", colorYellow, colorReset)
		if cfg != nil && len(cfg.Routes) > 0 {
			fmt.Printf("  Hint:     Run %squrl-frpc run%s to start tunnels\n", colorCyan, colorReset)
		}
	}

	if len(routes) > 0 {
		fmt.Printf("\n  %-20s %-8s %-22s %-12s %s\n",
			"NAME", "TYPE", "TARGET", "STATUS", "REMOTE")
		fmt.Printf("  %s\n", strings.Repeat("-", 80))
		for _, r := range routes {
			statusColor := colorYellow
			if r.Status == "running" {
				statusColor = colorGreen
			}
			remote := r.RemoteAddr
			if remote == "" {
				remote = "-"
			}
			fmt.Printf("  %-20s %-8s %-22s %s%-12s%s %s\n",
				truncate(r.Name, 20),
				r.Type,
				truncate(r.Target, 22),
				statusColor, truncate(r.Status, 12), colorReset,
				remote,
			)
		}
	} else if cfg == nil || len(cfg.Routes) == 0 {
		fmt.Printf("\n  No routes configured. Run %squrl-frpc add%s to register services.\n", colorCyan, colorReset)
	}
	fmt.Println()

	return nil
}

// buildProxyLookup flattens the FRP admin API proxy map into a name-keyed lookup.
func buildProxyLookup(proxyMap map[string][]adminProxyStatus) map[string]adminProxyStatus {
	lookup := make(map[string]adminProxyStatus)
	for _, proxies := range proxyMap {
		for _, p := range proxies {
			lookup[p.Name] = p
		}
	}
	return lookup
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-3] + "..."
}
