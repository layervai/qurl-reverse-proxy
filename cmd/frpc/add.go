package main

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/layervai/qurl-reverse-proxy/pkg/apiclient"
	nhpconfig "github.com/layervai/qurl-reverse-proxy/pkg/config"
)

var (
	addTarget   string
	addName     string
	addNoVerify bool
)

func init() {
	addCmd.Flags().StringVar(&addTarget, "target", "", "target URL (e.g. http://localhost:8080, tcp://localhost:5000)")
	addCmd.Flags().StringVar(&addName, "name", "", "human-readable service name")
	addCmd.Flags().BoolVar(&addNoVerify, "no-verify", false, "skip target reachability check")

	_ = addCmd.MarkFlagRequired("target")
	_ = addCmd.MarkFlagRequired("name")
}

var addCmd = &cobra.Command{
	Use:   "add",
	Short: "Add a new service route",
	Long: `Add a new service route to the QURL reverse proxy configuration.

Examples:
  qurl-frpc add --target http://localhost:8080 --name "My App"
  qurl-frpc add --target tcp://localhost:5000 --name "Home NAS"
  qurl-frpc add --target ssh://localhost --name "SSH Access"`,
	RunE: runAdd,
}

// parseTarget parses a target URL and returns the route type, host, port, and
// the original URL normalized with a default port when needed.
func parseTarget(raw string) (nhpconfig.RouteType, string, int, string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", "", 0, "", fmt.Errorf("invalid target URL: %w", err)
	}

	scheme := strings.ToLower(u.Scheme)
	host := u.Hostname()
	if host == "" {
		host = "127.0.0.1"
	}

	portStr := u.Port()
	var port int
	var routeType nhpconfig.RouteType

	switch scheme {
	case "http":
		routeType = nhpconfig.RouteTypeHTTP
		if portStr == "" {
			port = 80
		}
	case "https":
		routeType = nhpconfig.RouteTypeHTTP
		if portStr == "" {
			port = 443
		}
	case "tcp":
		routeType = nhpconfig.RouteTypeTCP
		if portStr == "" {
			return "", "", 0, "", fmt.Errorf("tcp:// target requires an explicit port")
		}
	case "ssh":
		routeType = nhpconfig.RouteTypeTCP
		if portStr == "" {
			port = 22
		}
	default:
		return "", "", 0, "", fmt.Errorf("unsupported scheme %q (use http://, https://, tcp://, or ssh://)", scheme)
	}

	if port == 0 {
		_, err := fmt.Sscanf(portStr, "%d", &port)
		if err != nil || port <= 0 || port > 65535 {
			return "", "", 0, "", fmt.Errorf("invalid port %q", portStr)
		}
	}

	return routeType, host, port, raw, nil
}

// sanitizeName converts a human-readable name to a safe subdomain component.
var nonAlphaNum = regexp.MustCompile(`[^a-z0-9]+`)

func sanitizeName(name string) string {
	s := strings.ToLower(name)
	s = nonAlphaNum.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "service"
	}
	return s
}

// getShortMachineID returns a short machine identifier for subdomain generation.
// This mirrors getMachineID in main.go but is kept as a separate function to
// avoid coupling the CLI subcommands to the FRP startup flow.
func getShortMachineID() string {
	return getMachineID()
}

func runAdd(_ *cobra.Command, _ []string) error {
	routeType, host, port, targetURL, err := parseTarget(addTarget)
	if err != nil {
		return err
	}

	// Verify target is reachable unless --no-verify is set
	if !addNoVerify {
		addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
		conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
		if err != nil {
			fmt.Printf("Warning: target %s is not reachable: %v\n", addr, err)
		} else {
			conn.Close()
		}
	}

	// Load or create config
	cfgPath, _, discoverErr := nhpconfig.Discover(cfgFile)

	var cfg *nhpconfig.Config
	if discoverErr == nil {
		cfg, err = nhpconfig.Load(cfgPath)
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}
	} else {
		// No existing config found; create a new one in the current directory
		cfg = &nhpconfig.Config{}
		cfgPath = "qurl-proxy.yaml"
	}

	// Check for duplicate route name
	for _, r := range cfg.Routes {
		if strings.EqualFold(r.Name, addName) {
			return fmt.Errorf("a route named %q already exists", addName)
		}
	}

	// Build the new route
	route := nhpconfig.Route{
		Name:      addName,
		Type:      routeType,
		LocalIP:   host,
		LocalPort: port,
		TargetURL: targetURL,
	}

	// Generate subdomain for HTTP routes
	if routeType == nhpconfig.RouteTypeHTTP {
		mid := cfg.NHP.MachineID
		if mid == "" {
			mid = getShortMachineID()
			cfg.NHP.MachineID = mid
		}
		route.Subdomain = mid + "-" + sanitizeName(addName)
	}

	// Register with QURL API if token is available
	if tok := getToken(); tok != "" {
		client := apiclient.New(getAPIBaseURL(), tok)
		resp, apiErr := client.CreateResource(context.Background(), &apiclient.CreateResourceRequest{
			Name:      addName,
			TargetURL: targetURL,
			Type:      string(routeType),
		})
		if apiErr != nil {
			fmt.Printf("Warning: failed to register with QURL API: %v\n", apiErr)
		} else {
			route.ResourceID = resp.ID
			fmt.Printf("Registered with QURL API (resource_id: %s)\n", resp.ID)
		}
	}

	// Append and save
	cfg.Routes = append(cfg.Routes, route)
	if err := nhpconfig.Save(cfg, cfgPath); err != nil {
		return fmt.Errorf("saving config: %w", err)
	}

	// Print success
	fmt.Printf("Added route %q (%s) -> %s:%d\n", route.Name, route.Type, route.LocalIP, route.LocalPort)
	if route.Subdomain != "" {
		fmt.Printf("Subdomain: %s\n", route.Subdomain)
	}
	fmt.Printf("Config saved to %s\n", cfgPath)

	return nil
}
