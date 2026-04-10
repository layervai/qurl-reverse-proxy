//go:build linux

package service

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type systemdManager struct{}

// New returns a Manager that uses Linux systemd.
func New() Manager {
	return &systemdManager{}
}

func (m *systemdManager) Install(cfg Config) error {
	unitPath, err := SystemdUnitPath(cfg.UserLevel)
	if err != nil {
		return err
	}

	// Ensure the parent directory exists.
	if err := os.MkdirAll(filepath.Dir(unitPath), 0o755); err != nil {
		return fmt.Errorf("creating systemd unit directory: %w", err)
	}

	content, err := RenderSystemdUnit(systemdUnitData{
		BinaryPath: cfg.BinaryPath,
		ConfigPath: cfg.ConfigPath,
		Token:      cfg.Token,
	})
	if err != nil {
		return err
	}

	if err := os.WriteFile(unitPath, []byte(content), 0o644); err != nil {
		return fmt.Errorf("writing systemd unit file: %w", err)
	}

	userFlag := ""
	if cfg.UserLevel {
		userFlag = "--user"
	}

	// Reload systemd, enable and start the service.
	commands := [][]string{
		{"systemctl", "daemon-reload"},
		{"systemctl", "enable", systemdUnitName},
		{"systemctl", "start", systemdUnitName},
	}
	if userFlag != "" {
		for i := range commands {
			commands[i] = append(commands[i][:1], append([]string{userFlag}, commands[i][1:]...)...)
		}
	}

	for _, args := range commands {
		cmd := exec.Command(args[0], args[1:]...)
		if output, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("%s: %w\n%s", strings.Join(args, " "), err, output)
		}
	}

	return nil
}

func (m *systemdManager) Uninstall() error {
	// Try user-level first, then system-level.
	userPath, _ := SystemdUnitPath(true)
	systemPath, _ := SystemdUnitPath(false)

	// Determine which level is installed.
	userLevel := false
	unitPath := systemPath // default; overwritten below if user-level
	if _, err := os.Stat(userPath); err == nil {
		userLevel = true
		unitPath = userPath
	} else if _, err := os.Stat(systemPath); err == nil {
		userLevel = false
	} else {
		return fmt.Errorf("service is not installed")
	}

	userFlag := ""
	if userLevel {
		userFlag = "--user"
	}

	// Stop, disable, remove, and reload.
	stopDisable := [][]string{
		{"systemctl", "stop", systemdUnitName},
		{"systemctl", "disable", systemdUnitName},
	}
	if userFlag != "" {
		for i := range stopDisable {
			stopDisable[i] = append(stopDisable[i][:1], append([]string{userFlag}, stopDisable[i][1:]...)...)
		}
	}

	for _, args := range stopDisable {
		cmd := exec.Command(args[0], args[1:]...)
		_ = cmd.Run() // ignore errors for stop/disable
	}

	if err := os.Remove(unitPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("removing unit file: %w", err)
	}

	reloadArgs := []string{"systemctl", "daemon-reload"}
	if userFlag != "" {
		reloadArgs = []string{"systemctl", userFlag, "daemon-reload"}
	}
	cmd := exec.Command(reloadArgs[0], reloadArgs[1:]...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("daemon-reload: %w\n%s", err, output)
	}

	return nil
}

func (m *systemdManager) Status() (ServiceStatus, error) {
	var status ServiceStatus

	// Check user-level, then system-level.
	userPath, _ := SystemdUnitPath(true)
	systemPath, _ := SystemdUnitPath(false)

	userLevel := false
	if _, err := os.Stat(userPath); err == nil {
		status.Installed = true
		userLevel = true
	} else if _, err := os.Stat(systemPath); err == nil {
		status.Installed = true
	}

	if !status.Installed {
		return status, nil
	}

	// Check if the service is active.
	args := []string{"systemctl", "is-active", systemdUnitName}
	if userLevel {
		args = []string{"systemctl", "--user", "is-active", systemdUnitName}
	}
	cmd := exec.Command(args[0], args[1:]...)
	output, err := cmd.Output()
	if err == nil && strings.TrimSpace(string(output)) == "active" {
		status.Running = true
	}

	return status, nil
}
