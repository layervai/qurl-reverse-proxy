package service

// Manager manages the proxy client as an OS background service.
type Manager interface {
	Install(cfg Config) error
	Uninstall() error
	Status() (ServiceStatus, error)
}

// Config holds configuration for installing the proxy client as a service.
type Config struct {
	BinaryPath string // path to qurl-frpc binary
	ConfigPath string // path to qurl-proxy.yaml
	Token      string // LAYERV_TOKEN to embed (optional)
	UserLevel  bool   // true for user-level service (no root)
}

// ServiceStatus reports the current state of the installed service.
type ServiceStatus struct {
	Installed bool
	Running   bool
}
