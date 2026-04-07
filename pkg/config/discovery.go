package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const (
	yamlConfigName  = "qurl-proxy.yaml"
	legacyTOMLName  = "frpc.toml"
	configSubdir    = "etc"
	userConfigDir   = ".config/qurl"
)

// Discover locates the configuration file to use. It checks, in order:
//  1. The explicit path from configFlag (error if not found).
//  2. ./qurl-proxy.yaml in the current working directory.
//  3. <binary_dir>/etc/qurl-proxy.yaml alongside the running binary.
//  4. ~/.config/qurl/qurl-proxy.yaml in the user's home directory.
//  5. <binary_dir>/etc/frpc.toml as a legacy fallback (isLegacy=true).
//
// If no file is found, an error is returned.
func Discover(configFlag string) (path string, isLegacy bool, err error) {
	// 1. Explicit flag takes priority.
	if configFlag != "" {
		if _, err := os.Stat(configFlag); err != nil {
			return "", false, fmt.Errorf("config file specified but not found: %w", err)
		}
		return configFlag, false, nil
	}

	// 2. Current working directory.
	if cwd, err := os.Getwd(); err == nil {
		p := filepath.Join(cwd, yamlConfigName)
		if fileExists(p) {
			return p, false, nil
		}
	}

	// 3. Binary directory / etc.
	if binDir, err := executableDir(); err == nil {
		p := filepath.Join(binDir, configSubdir, yamlConfigName)
		if fileExists(p) {
			return p, false, nil
		}
	}

	// 4. User config directory.
	if home, err := os.UserHomeDir(); err == nil {
		p := filepath.Join(home, userConfigDir, yamlConfigName)
		if fileExists(p) {
			return p, false, nil
		}
	}

	// 5. Legacy TOML fallback next to the binary.
	if binDir, err := executableDir(); err == nil {
		p := filepath.Join(binDir, configSubdir, legacyTOMLName)
		if fileExists(p) {
			return p, true, nil
		}
	}

	return "", false, errors.New("no configuration file found; create qurl-proxy.yaml or pass --config")
}

// fileExists returns true if the path exists and is a regular file.
func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// executableDir returns the directory containing the running binary,
// resolving any symlinks.
func executableDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return "", err
	}
	return filepath.Dir(exe), nil
}
