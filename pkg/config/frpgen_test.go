package config

import (
	"testing"

	v1 "github.com/fatedier/frp/pkg/config/v1"
)

func TestGenerateFRPClientConfig_Basic(t *testing.T) {
	cfg := &Config{
		Server: ServerConfig{
			Addr:     "frps.example.com",
			Port:     7000,
			Token:    "secret",
			Protocol: "kcp",
		},
		Routes: []Route{
			{
				Name:      "web",
				Type:      RouteTypeHTTP,
				LocalIP:   "127.0.0.1",
				LocalPort: 8080,
				Subdomain: "myapp",
				HostRewrite: "localhost",
				Headers: map[string]string{
					"X-Real-IP": "pass",
				},
			},
			{
				Name:       "ssh",
				Type:       RouteTypeTCP,
				LocalIP:    "127.0.0.1",
				LocalPort:  22,
				RemotePort: 6022,
			},
		},
	}

	common, proxies, visitors, err := GenerateFRPClientConfig(cfg, "machine-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify common config.
	if common.ServerAddr != "frps.example.com" {
		t.Errorf("ServerAddr = %q, want %q", common.ServerAddr, "frps.example.com")
	}
	if common.ServerPort != 7000 {
		t.Errorf("ServerPort = %d, want 7000", common.ServerPort)
	}
	if common.Auth.Token != "secret" {
		t.Errorf("Auth.Token = %q, want %q", common.Auth.Token, "secret")
	}
	if common.Transport.Protocol != "kcp" {
		t.Errorf("Transport.Protocol = %q, want %q", common.Transport.Protocol, "kcp")
	}

	// Verify proxies.
	if len(proxies) != 2 {
		t.Fatalf("expected 2 proxies, got %d", len(proxies))
	}
	if visitors != nil {
		t.Errorf("expected nil visitors, got %v", visitors)
	}

	// HTTP proxy.
	httpProxy, ok := proxies[0].(*v1.HTTPProxyConfig)
	if !ok {
		t.Fatalf("proxies[0] type = %T, want *v1.HTTPProxyConfig", proxies[0])
	}
	if httpProxy.Name != "web" {
		t.Errorf("http proxy Name = %q, want %q", httpProxy.Name, "web")
	}
	if httpProxy.Type != "http" {
		t.Errorf("http proxy Type = %q, want %q", httpProxy.Type, "http")
	}
	if httpProxy.LocalIP != "127.0.0.1" {
		t.Errorf("http proxy LocalIP = %q, want %q", httpProxy.LocalIP, "127.0.0.1")
	}
	if httpProxy.LocalPort != 8080 {
		t.Errorf("http proxy LocalPort = %d, want 8080", httpProxy.LocalPort)
	}
	if httpProxy.SubDomain != "myapp" {
		t.Errorf("http proxy SubDomain = %q, want %q", httpProxy.SubDomain, "myapp")
	}
	if httpProxy.HostHeaderRewrite != "localhost" {
		t.Errorf("http proxy HostHeaderRewrite = %q, want %q", httpProxy.HostHeaderRewrite, "localhost")
	}
	if httpProxy.RequestHeaders.Set["X-Real-IP"] != "pass" {
		t.Errorf("http proxy header X-Real-IP = %q, want %q", httpProxy.RequestHeaders.Set["X-Real-IP"], "pass")
	}

	// TCP proxy.
	tcpProxy, ok := proxies[1].(*v1.TCPProxyConfig)
	if !ok {
		t.Fatalf("proxies[1] type = %T, want *v1.TCPProxyConfig", proxies[1])
	}
	if tcpProxy.Name != "ssh" {
		t.Errorf("tcp proxy Name = %q, want %q", tcpProxy.Name, "ssh")
	}
	if tcpProxy.Type != "tcp" {
		t.Errorf("tcp proxy Type = %q, want %q", tcpProxy.Type, "tcp")
	}
	if tcpProxy.RemotePort != 6022 {
		t.Errorf("tcp proxy RemotePort = %d, want 6022", tcpProxy.RemotePort)
	}
}

func TestGenerateFRPClientConfig_MachineIDTemplate(t *testing.T) {
	cfg := &Config{
		Server: ServerConfig{
			Addr: "example.com",
			Port: 7000,
		},
		Routes: []Route{
			{
				Name:      "admin",
				Type:      RouteTypeHTTP,
				LocalIP:   "127.0.0.1",
				LocalPort: 9090,
				Subdomain: "admin-{{ .MachineID }}",
			},
		},
	}

	_, proxies, _, err := GenerateFRPClientConfig(cfg, "abc123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	httpProxy := proxies[0].(*v1.HTTPProxyConfig)
	if httpProxy.SubDomain != "admin-abc123" {
		t.Errorf("SubDomain = %q, want %q", httpProxy.SubDomain, "admin-abc123")
	}
}

func TestGenerateFRPClientConfig_MachineIDTemplateNoSpaces(t *testing.T) {
	cfg := &Config{
		Server: ServerConfig{
			Addr: "example.com",
			Port: 7000,
		},
		Routes: []Route{
			{
				Name:      "admin",
				Type:      RouteTypeHTTP,
				LocalIP:   "127.0.0.1",
				LocalPort: 9090,
				Subdomain: "admin-{{.MachineID}}",
			},
		},
	}

	_, proxies, _, err := GenerateFRPClientConfig(cfg, "xyz789")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	httpProxy := proxies[0].(*v1.HTTPProxyConfig)
	if httpProxy.SubDomain != "admin-xyz789" {
		t.Errorf("SubDomain = %q, want %q", httpProxy.SubDomain, "admin-xyz789")
	}
}

func TestGenerateFRPClientConfig_NoToken(t *testing.T) {
	cfg := &Config{
		Server: ServerConfig{
			Addr: "example.com",
			Port: 7000,
		},
		Routes: []Route{
			{
				Name:      "web",
				Type:      RouteTypeHTTP,
				LocalIP:   "127.0.0.1",
				LocalPort: 80,
				Subdomain: "app",
			},
		},
	}

	common, _, _, err := GenerateFRPClientConfig(cfg, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if common.Auth.Token != "" {
		t.Errorf("Auth.Token = %q, want empty", common.Auth.Token)
	}
}

func TestGenerateFRPClientConfig_NoProtocol(t *testing.T) {
	cfg := &Config{
		Server: ServerConfig{
			Addr: "example.com",
			Port: 7000,
		},
		Routes: []Route{
			{
				Name:      "web",
				Type:      RouteTypeHTTP,
				LocalIP:   "127.0.0.1",
				LocalPort: 80,
				Subdomain: "app",
			},
		},
	}

	common, _, _, err := GenerateFRPClientConfig(cfg, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if common.Transport.Protocol != "" {
		t.Errorf("Transport.Protocol = %q, want empty (FRP will default to tcp)", common.Transport.Protocol)
	}
}

func TestGenerateFRPClientConfig_CustomDomains(t *testing.T) {
	cfg := &Config{
		Server: ServerConfig{
			Addr: "example.com",
			Port: 7000,
		},
		Routes: []Route{
			{
				Name:          "web",
				Type:          RouteTypeHTTP,
				LocalIP:       "127.0.0.1",
				LocalPort:     80,
				CustomDomains: []string{"app.example.com", "www.example.com"},
			},
		},
	}

	_, proxies, _, err := GenerateFRPClientConfig(cfg, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	httpProxy := proxies[0].(*v1.HTTPProxyConfig)
	if len(httpProxy.CustomDomains) != 2 {
		t.Fatalf("expected 2 custom domains, got %d", len(httpProxy.CustomDomains))
	}
	if httpProxy.CustomDomains[0] != "app.example.com" {
		t.Errorf("CustomDomains[0] = %q, want %q", httpProxy.CustomDomains[0], "app.example.com")
	}
}

func TestGenerateFRPClientConfig_UnsupportedType(t *testing.T) {
	cfg := &Config{
		Server: ServerConfig{
			Addr: "example.com",
			Port: 7000,
		},
		Routes: []Route{
			{
				Name:      "bad",
				Type:      RouteType("frp_udp"),
				LocalIP:   "127.0.0.1",
				LocalPort: 80,
			},
		},
	}

	_, _, _, err := GenerateFRPClientConfig(cfg, "")
	if err == nil {
		t.Fatal("expected error for unsupported route type")
	}
}
