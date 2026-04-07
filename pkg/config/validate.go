package config

import (
	"errors"
	"fmt"
)

// Validate checks cfg for structural correctness and returns a combined error
// listing every violation found. It returns nil when the config is valid.
func Validate(cfg *Config) error {
	var errs []error

	// Server validation
	if cfg.Server.Addr == "" {
		errs = append(errs, errors.New("server.addr is required"))
	}
	if cfg.Server.Port < 1 || cfg.Server.Port > 65535 {
		errs = append(errs, fmt.Errorf("server.port must be 1-65535, got %d", cfg.Server.Port))
	}

	// Route validation
	seen := make(map[string]bool, len(cfg.Routes))
	for i, r := range cfg.Routes {
		prefix := fmt.Sprintf("routes[%d]", i)

		if r.Name == "" {
			errs = append(errs, fmt.Errorf("%s: name is required", prefix))
		} else if seen[r.Name] {
			errs = append(errs, fmt.Errorf("%s: duplicate route name %q", prefix, r.Name))
		} else {
			seen[r.Name] = true
		}

		switch r.Type {
		case RouteTypeHTTP:
			if r.Subdomain == "" && len(r.CustomDomains) == 0 {
				errs = append(errs, fmt.Errorf("%s (%s): frp_http requires subdomain or custom_domains", prefix, r.Name))
			}
		case RouteTypeTCP:
			if r.RemotePort == 0 {
				errs = append(errs, fmt.Errorf("%s (%s): frp_tcp requires remote_port", prefix, r.Name))
			}
		default:
			errs = append(errs, fmt.Errorf("%s (%s): unsupported route type %q", prefix, r.Name, r.Type))
		}

		if r.LocalPort < 1 || r.LocalPort > 65535 {
			errs = append(errs, fmt.Errorf("%s (%s): local_port must be 1-65535, got %d", prefix, r.Name, r.LocalPort))
		}
	}

	return errors.Join(errs...)
}
