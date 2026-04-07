// Package config provides YAML-based configuration for the QURL reverse proxy.
// It loads a high-level YAML config and can generate FRP v1 client configs.
package config

import (
	"fmt"
	"os"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// Config is the top-level QURL proxy configuration.
type Config struct {
	Server ServerConfig `yaml:"server"`
	NHP    NHPConfig    `yaml:"nhp"`
	QURL   QURLConfig   `yaml:"qurl"`
	Routes []Route      `yaml:"routes"`
}

// ServerConfig holds connection details for the FRP server.
type ServerConfig struct {
	Addr     string `yaml:"addr"`
	Port     int    `yaml:"port"`
	Token    string `yaml:"token,omitempty"`
	Protocol string `yaml:"protocol,omitempty"` // tcp, kcp, quic, websocket
}

// NHPConfig holds Network Hiding Protocol settings.
type NHPConfig struct {
	Enabled   bool   `yaml:"enabled"`
	MachineID string `yaml:"machine_id,omitempty"`
}

// QURLConfig holds QURL service integration settings.
type QURLConfig struct {
	APIURL   string `yaml:"api_url,omitempty"`
	Token    string `yaml:"token,omitempty"`
	AuditLog string `yaml:"audit_log,omitempty"`
}

// Route describes a single proxy route.
type Route struct {
	Name          string            `yaml:"name"`
	Type          RouteType         `yaml:"type"`
	LocalIP       string            `yaml:"local_ip,omitempty"`
	LocalPort     int               `yaml:"local_port"`
	RemotePort    int               `yaml:"remote_port,omitempty"`
	Subdomain     string            `yaml:"subdomain,omitempty"`
	CustomDomains []string          `yaml:"custom_domains,omitempty"`
	HostRewrite   string            `yaml:"host_rewrite,omitempty"`
	Headers       map[string]string `yaml:"headers,omitempty"`
	ResourceID    string            `yaml:"resource_id,omitempty"`
	TargetURL     string            `yaml:"target_url,omitempty"`
}

// RouteType identifies the proxy protocol for a route.
type RouteType string

const (
	// RouteTypeHTTP proxies HTTP traffic via FRP's HTTP proxy.
	RouteTypeHTTP RouteType = "frp_http"
	// RouteTypeTCP proxies raw TCP traffic via FRP's TCP proxy.
	RouteTypeTCP RouteType = "frp_tcp"
)

// envVarPattern matches ${VAR} and ${VAR:-default} patterns.
var envVarPattern = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}`)

// resolveEnvVars replaces ${VAR} and ${VAR:-default} patterns in s with
// corresponding environment variable values. If a variable is unset and no
// default is provided, the placeholder is replaced with an empty string.
func resolveEnvVars(s string) string {
	return envVarPattern.ReplaceAllStringFunc(s, func(match string) string {
		parts := envVarPattern.FindStringSubmatch(match)
		if parts == nil {
			return match
		}
		name := parts[1]
		defaultVal := parts[2]

		if val, ok := os.LookupEnv(name); ok {
			return val
		}
		return defaultVal
	})
}

// Load reads a YAML configuration file from path, resolves environment
// variable placeholders, validates the result, and applies defaults.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config file %s: %w", path, err)
	}

	resolved := resolveEnvVars(string(data))

	var cfg Config
	dec := yaml.NewDecoder(strings.NewReader(resolved))
	dec.KnownFields(true)
	if err := dec.Decode(&cfg); err != nil {
		return nil, fmt.Errorf("parsing config file %s: %w", path, err)
	}

	applyDefaults(&cfg)

	if err := Validate(&cfg); err != nil {
		return nil, fmt.Errorf("validating config: %w", err)
	}

	return &cfg, nil
}

// applyDefaults fills in zero-value fields with sensible defaults.
func applyDefaults(cfg *Config) {
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 7000
	}
	for i := range cfg.Routes {
		if cfg.Routes[i].LocalIP == "" {
			cfg.Routes[i].LocalIP = "127.0.0.1"
		}
	}
}
