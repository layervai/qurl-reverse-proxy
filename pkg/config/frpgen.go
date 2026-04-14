package config

import (
	"fmt"
	"strings"

	v1 "github.com/fatedier/frp/pkg/config/v1"
)

// GenerateFRPClientConfig converts a QURL Config into the FRP v1 types that
// can be passed directly to client.NewService(). The machineID is injected
// into any subdomain template containing {{ .MachineID }}.
func GenerateFRPClientConfig(cfg *Config, machineID string) (*v1.ClientCommonConfig, []v1.ProxyConfigurer, []v1.VisitorConfigurer, error) {
	common := &v1.ClientCommonConfig{
		ServerAddr: cfg.Server.Addr,
		ServerPort: cfg.Server.Port,
	}

	if cfg.Server.Token != "" {
		common.Auth.Token = cfg.Server.Token
	}

	if cfg.Server.Protocol != "" {
		common.Transport.Protocol = cfg.Server.Protocol
	}

	// Reconnection resilience: prevent exit on login failure, tune keepalive.
	common.LoginFailExit = cfg.Server.LoginFailExit
	common.Transport.DialServerKeepAlive = int64(cfg.Server.Keepalive)
	common.Transport.DialServerTimeout = int64(cfg.Server.DialTimeout)

	proxies := make([]v1.ProxyConfigurer, 0, len(cfg.Routes))
	for _, route := range cfg.Routes {
		pc, err := routeToProxy(route, machineID)
		if err != nil {
			return nil, nil, nil, fmt.Errorf("generating proxy for route %q: %w", route.Name, err)
		}
		proxies = append(proxies, pc)
	}

	// No visitors are generated from the QURL config at this time.
	return common, proxies, nil, nil
}

// routeToProxy converts a single Route into the appropriate FRP ProxyConfigurer.
func routeToProxy(r Route, machineID string) (v1.ProxyConfigurer, error) {
	switch r.Type {
	case RouteTypeHTTP:
		return buildHTTPProxy(r, machineID), nil
	case RouteTypeTCP:
		return buildTCPProxy(r), nil
	default:
		return nil, fmt.Errorf("unsupported route type %q", r.Type)
	}
}

// buildHTTPProxy creates an FRP HTTPProxyConfig from a Route.
func buildHTTPProxy(r Route, machineID string) *v1.HTTPProxyConfig {
	pc := &v1.HTTPProxyConfig{}
	pc.Name = r.Name
	pc.Type = string(v1.ProxyTypeHTTP)
	pc.LocalIP = r.LocalIP
	pc.LocalPort = r.LocalPort

	subdomain := expandMachineID(r.Subdomain, machineID)
	pc.SubDomain = subdomain
	pc.CustomDomains = r.CustomDomains

	if r.HostRewrite != "" {
		pc.HostHeaderRewrite = r.HostRewrite
	}

	if len(r.Headers) > 0 {
		pc.RequestHeaders = v1.HeaderOperations{
			Set: r.Headers,
		}
	}

	return pc
}

// buildTCPProxy creates an FRP TCPProxyConfig from a Route.
func buildTCPProxy(r Route) *v1.TCPProxyConfig {
	pc := &v1.TCPProxyConfig{}
	pc.Name = r.Name
	pc.Type = string(v1.ProxyTypeTCP)
	pc.LocalIP = r.LocalIP
	pc.LocalPort = r.LocalPort
	pc.RemotePort = r.RemotePort
	return pc
}

// expandMachineID replaces {{ .MachineID }} (with flexible whitespace) in s
// with the provided machineID value.
func expandMachineID(s, machineID string) string {
	// Handle both "{{.MachineID}}" and "{{ .MachineID }}" style templates.
	s = strings.ReplaceAll(s, "{{ .MachineID }}", machineID)
	s = strings.ReplaceAll(s, "{{.MachineID}}", machineID)
	return s
}
