//go:build !darwin && !linux

package service

import "fmt"

type stubManager struct{}

// New returns a Manager that returns errors on unsupported platforms.
func New() Manager {
	return &stubManager{}
}

func (m *stubManager) Install(_ Config) error {
	return fmt.Errorf("service management not supported on this platform")
}

func (m *stubManager) Uninstall() error {
	return fmt.Errorf("service management not supported on this platform")
}

func (m *stubManager) Status() (ServiceStatus, error) {
	return ServiceStatus{}, fmt.Errorf("service management not supported on this platform")
}
