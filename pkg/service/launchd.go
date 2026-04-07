//go:build darwin

package service

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type launchdManager struct{}

// New returns a Manager that uses macOS launchd.
func New() Manager {
	return &launchdManager{}
}

func (m *launchdManager) Install(cfg Config) error {
	plistPath, err := LaunchdPlistPath()
	if err != nil {
		return err
	}

	logDir, err := LaunchdLogDir()
	if err != nil {
		return err
	}

	// Ensure the LaunchAgents directory exists.
	if err := os.MkdirAll(filepath.Dir(plistPath), 0o755); err != nil {
		return fmt.Errorf("creating LaunchAgents directory: %w", err)
	}

	// Ensure the log directory exists.
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return fmt.Errorf("creating log directory: %w", err)
	}

	content, err := RenderLaunchdPlist(launchdPlistData{
		BinaryPath: cfg.BinaryPath,
		ConfigPath: cfg.ConfigPath,
		LogDir:     logDir,
		Token:      cfg.Token,
	})
	if err != nil {
		return err
	}

	if err := os.WriteFile(plistPath, []byte(content), 0o644); err != nil {
		return fmt.Errorf("writing plist file: %w", err)
	}

	cmd := exec.Command("launchctl", "load", "-w", plistPath)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("launchctl load: %w\n%s", err, output)
	}

	return nil
}

func (m *launchdManager) Uninstall() error {
	plistPath, err := LaunchdPlistPath()
	if err != nil {
		return err
	}

	// Unload the service (ignore errors if not loaded).
	cmd := exec.Command("launchctl", "unload", plistPath)
	_ = cmd.Run()

	if err := os.Remove(plistPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("removing plist file: %w", err)
	}

	return nil
}

func (m *launchdManager) Status() (ServiceStatus, error) {
	plistPath, err := LaunchdPlistPath()
	if err != nil {
		return ServiceStatus{}, err
	}

	var status ServiceStatus

	// Check if plist file exists.
	if _, err := os.Stat(plistPath); err == nil {
		status.Installed = true
	} else if os.IsNotExist(err) {
		return status, nil
	} else {
		return status, fmt.Errorf("checking plist file: %w", err)
	}

	// Check if the service is running via launchctl list.
	cmd := exec.Command("launchctl", "list")
	output, err := cmd.Output()
	if err != nil {
		return status, fmt.Errorf("launchctl list: %w", err)
	}

	if strings.Contains(string(output), launchdLabel) {
		status.Running = true
	}

	return status, nil
}
