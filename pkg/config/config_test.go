package config

import (
	"os"
	"path/filepath"
	"testing"
)

// writeConfig is a test helper that writes YAML content to a temp file and
// returns its path.
func writeConfig(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "qurl-proxy.yaml")
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatalf("writing temp config: %v", err)
	}
	return p
}

func TestLoad_ValidConfig(t *testing.T) {
	yaml := `
server:
  addr: frps.example.com
  port: 7000
  token: secret
  protocol: tcp
nhp:
  enabled: true
  machine_id: abc123
qurl:
  api_url: https://api.example.com
  token: qurl-token
  audit_log: /var/log/audit.log
routes:
  - name: web
    type: frp_http
    local_port: 8080
    subdomain: myapp
    host_rewrite: localhost
    headers:
      X-Custom: value
  - name: ssh
    type: frp_tcp
    local_port: 22
    remote_port: 6022
`
	cfg, err := Load(writeConfig(t, yaml))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.Server.Addr != "frps.example.com" {
		t.Errorf("server.addr = %q, want %q", cfg.Server.Addr, "frps.example.com")
	}
	if cfg.Server.Port != 7000 {
		t.Errorf("server.port = %d, want 7000", cfg.Server.Port)
	}
	if cfg.Server.Token != "secret" {
		t.Errorf("server.token = %q, want %q", cfg.Server.Token, "secret")
	}
	if cfg.NHP.Enabled != true {
		t.Error("nhp.enabled should be true")
	}
	if len(cfg.Routes) != 2 {
		t.Fatalf("expected 2 routes, got %d", len(cfg.Routes))
	}

	// Check defaults were applied.
	if cfg.Routes[0].LocalIP != "127.0.0.1" {
		t.Errorf("routes[0].local_ip = %q, want 127.0.0.1", cfg.Routes[0].LocalIP)
	}
	if cfg.Routes[1].LocalIP != "127.0.0.1" {
		t.Errorf("routes[1].local_ip = %q, want 127.0.0.1", cfg.Routes[1].LocalIP)
	}
}

func TestLoad_DefaultPort(t *testing.T) {
	yaml := `
server:
  addr: example.com
routes:
  - name: web
    type: frp_http
    local_port: 80
    subdomain: app
`
	cfg, err := Load(writeConfig(t, yaml))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Server.Port != 7000 {
		t.Errorf("default port = %d, want 7000", cfg.Server.Port)
	}
}

func TestLoad_DefaultLocalIP(t *testing.T) {
	yaml := `
server:
  addr: example.com
routes:
  - name: web
    type: frp_http
    local_port: 80
    subdomain: app
`
	cfg, err := Load(writeConfig(t, yaml))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Routes[0].LocalIP != "127.0.0.1" {
		t.Errorf("default local_ip = %q, want 127.0.0.1", cfg.Routes[0].LocalIP)
	}
}

func TestLoad_MissingFile(t *testing.T) {
	_, err := Load("/nonexistent/path.yaml")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestLoad_MissingServerAddr(t *testing.T) {
	yaml := `
server:
  port: 7000
routes:
  - name: web
    type: frp_http
    local_port: 80
    subdomain: app
`
	// Missing server.addr is allowed (routes can be added before server is configured)
	cfg, err := Load(writeConfig(t, yaml))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cfg.Routes) != 1 {
		t.Errorf("expected 1 route, got %d", len(cfg.Routes))
	}
}

func TestLoad_MissingRouteName(t *testing.T) {
	yaml := `
server:
  addr: example.com
routes:
  - type: frp_http
    local_port: 80
    subdomain: app
`
	_, err := Load(writeConfig(t, yaml))
	if err == nil {
		t.Fatal("expected validation error for missing route name")
	}
}

func TestLoad_DuplicateRouteNames(t *testing.T) {
	yaml := `
server:
  addr: example.com
routes:
  - name: web
    type: frp_http
    local_port: 80
    subdomain: app1
  - name: web
    type: frp_http
    local_port: 81
    subdomain: app2
`
	_, err := Load(writeConfig(t, yaml))
	if err == nil {
		t.Fatal("expected validation error for duplicate route names")
	}
}

func TestLoad_InvalidPortRanges(t *testing.T) {
	tests := []struct {
		name string
		yaml string
	}{
		{
			name: "server port too high",
			yaml: `
server:
  addr: example.com
  port: 65536
routes:
  - name: web
    type: frp_http
    local_port: 80
    subdomain: app
`,
		},
		{
			name: "server port negative",
			yaml: `
server:
  addr: example.com
  port: -1
routes:
  - name: web
    type: frp_http
    local_port: 80
    subdomain: app
`,
		},
		{
			name: "local port 0",
			yaml: `
server:
  addr: example.com
routes:
  - name: web
    type: frp_http
    local_port: 0
    subdomain: app
`,
		},
		{
			name: "local port too high",
			yaml: `
server:
  addr: example.com
routes:
  - name: web
    type: frp_http
    local_port: 65536
    subdomain: app
`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Load(writeConfig(t, tt.yaml))
			if err == nil {
				t.Fatalf("expected validation error for %s", tt.name)
			}
		})
	}
}

func TestLoad_TCPWithoutRemotePort(t *testing.T) {
	yaml := `
server:
  addr: example.com
routes:
  - name: ssh
    type: frp_tcp
    local_port: 22
`
	// remote_port is optional (server-assigned), so this should pass
	cfg, err := Load(writeConfig(t, yaml))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Routes[0].RemotePort != 0 {
		t.Errorf("expected remote_port 0, got %d", cfg.Routes[0].RemotePort)
	}
}

func TestLoad_HTTPWithoutSubdomainOrDomains(t *testing.T) {
	yaml := `
server:
  addr: example.com
routes:
  - name: web
    type: frp_http
    local_port: 80
`
	// subdomain/custom_domains are optional (may be auto-generated), so this should pass
	cfg, err := Load(writeConfig(t, yaml))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Routes[0].Subdomain != "" {
		t.Errorf("expected empty subdomain, got %q", cfg.Routes[0].Subdomain)
	}
}

func TestLoad_UnsupportedRouteType(t *testing.T) {
	yaml := `
server:
  addr: example.com
routes:
  - name: web
    type: frp_udp
    local_port: 80
`
	_, err := Load(writeConfig(t, yaml))
	if err == nil {
		t.Fatal("expected validation error for unsupported route type")
	}
}

func TestResolveEnvVars_Basic(t *testing.T) {
	t.Setenv("QURL_TEST_HOST", "myhost.example.com")
	result := resolveEnvVars("${QURL_TEST_HOST}")
	if result != "myhost.example.com" {
		t.Errorf("got %q, want %q", result, "myhost.example.com")
	}
}

func TestResolveEnvVars_WithDefault(t *testing.T) {
	// Ensure the var is not set.
	t.Setenv("QURL_TEST_UNSET_99", "")
	os.Unsetenv("QURL_TEST_UNSET_99")

	result := resolveEnvVars("${QURL_TEST_UNSET_99:-fallback}")
	if result != "fallback" {
		t.Errorf("got %q, want %q", result, "fallback")
	}
}

func TestResolveEnvVars_MissingNoDefault(t *testing.T) {
	os.Unsetenv("QURL_TEST_MISSING_42")
	result := resolveEnvVars("${QURL_TEST_MISSING_42}")
	if result != "" {
		t.Errorf("got %q, want empty string", result)
	}
}

func TestResolveEnvVars_SetOverridesDefault(t *testing.T) {
	t.Setenv("QURL_TEST_OVERRIDE", "real")
	result := resolveEnvVars("${QURL_TEST_OVERRIDE:-fallback}")
	if result != "real" {
		t.Errorf("got %q, want %q", result, "real")
	}
}

func TestResolveEnvVars_InYAML(t *testing.T) {
	t.Setenv("QURL_TEST_ADDR", "remote.host")
	t.Setenv("QURL_TEST_TOKEN", "s3cret")

	yaml := `
server:
  addr: ${QURL_TEST_ADDR}
  token: ${QURL_TEST_TOKEN}
routes:
  - name: web
    type: frp_http
    local_port: 80
    subdomain: app
`
	cfg, err := Load(writeConfig(t, yaml))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Server.Addr != "remote.host" {
		t.Errorf("server.addr = %q, want %q", cfg.Server.Addr, "remote.host")
	}
	if cfg.Server.Token != "s3cret" {
		t.Errorf("server.token = %q, want %q", cfg.Server.Token, "s3cret")
	}
}

func TestLoad_CustomDomainsValid(t *testing.T) {
	yaml := `
server:
  addr: example.com
routes:
  - name: web
    type: frp_http
    local_port: 80
    custom_domains:
      - app.example.com
      - www.example.com
`
	cfg, err := Load(writeConfig(t, yaml))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cfg.Routes[0].CustomDomains) != 2 {
		t.Errorf("expected 2 custom domains, got %d", len(cfg.Routes[0].CustomDomains))
	}
}
