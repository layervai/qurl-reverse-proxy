package service

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestRenderLaunchdPlist_AllFields(t *testing.T) {
	data := launchdPlistData{
		BinaryPath: "/usr/local/bin/qurl-frpc",
		ConfigPath: "/etc/qurl/proxy.yaml",
		LogDir:     "/Users/test/Library/Logs/qurl",
		Token:      "my-secret-token",
	}

	result, err := RenderLaunchdPlist(data)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Check XML header.
	if !strings.Contains(result, `<?xml version="1.0" encoding="UTF-8"?>`) {
		t.Error("missing XML header")
	}

	// Check label.
	if !strings.Contains(result, "<string>ai.layerv.qurl-frpc</string>") {
		t.Error("missing label")
	}

	// Check binary path.
	if !strings.Contains(result, "<string>/usr/local/bin/qurl-frpc</string>") {
		t.Error("missing binary path")
	}

	// Check config path.
	if !strings.Contains(result, "<string>/etc/qurl/proxy.yaml</string>") {
		t.Error("missing config path")
	}

	// Check log paths.
	if !strings.Contains(result, "<string>/Users/test/Library/Logs/qurl/qurl-frpc.log</string>") {
		t.Error("missing stdout log path")
	}
	if !strings.Contains(result, "<string>/Users/test/Library/Logs/qurl/qurl-frpc.err</string>") {
		t.Error("missing stderr log path")
	}

	// Check EnvironmentVariables block is present with token.
	if !strings.Contains(result, "<key>EnvironmentVariables</key>") {
		t.Error("missing EnvironmentVariables key")
	}
	if !strings.Contains(result, "<key>LAYERV_TOKEN</key>") {
		t.Error("missing LAYERV_TOKEN key")
	}
	if !strings.Contains(result, "<string>my-secret-token</string>") {
		t.Error("missing token value")
	}

	// Check RunAtLoad and KeepAlive.
	if !strings.Contains(result, "<key>RunAtLoad</key>") {
		t.Error("missing RunAtLoad")
	}
	if !strings.Contains(result, "<key>KeepAlive</key>") {
		t.Error("missing KeepAlive")
	}
}

func TestRenderLaunchdPlist_WithoutToken(t *testing.T) {
	data := launchdPlistData{
		BinaryPath: "/usr/local/bin/qurl-frpc",
		ConfigPath: "/etc/qurl/proxy.yaml",
		LogDir:     "/Users/test/Library/Logs/qurl",
		Token:      "",
	}

	result, err := RenderLaunchdPlist(data)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// EnvironmentVariables block should NOT be present.
	if strings.Contains(result, "<key>EnvironmentVariables</key>") {
		t.Error("EnvironmentVariables block should not be present when token is empty")
	}
	if strings.Contains(result, "LAYERV_TOKEN") {
		t.Error("LAYERV_TOKEN should not be present when token is empty")
	}

	// Core fields should still be present.
	if !strings.Contains(result, "<string>/usr/local/bin/qurl-frpc</string>") {
		t.Error("missing binary path")
	}
}

func TestRenderSystemdUnit_AllFields(t *testing.T) {
	data := systemdUnitData{
		BinaryPath: "/usr/local/bin/qurl-frpc",
		ConfigPath: "/etc/qurl/proxy.yaml",
		Token:      "my-secret-token",
	}

	result, err := RenderSystemdUnit(data)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Check section headers.
	if !strings.Contains(result, "[Unit]") {
		t.Error("missing [Unit] section")
	}
	if !strings.Contains(result, "[Service]") {
		t.Error("missing [Service] section")
	}
	if !strings.Contains(result, "[Install]") {
		t.Error("missing [Install] section")
	}

	// Check ExecStart.
	if !strings.Contains(result, "ExecStart=/usr/local/bin/qurl-frpc run --config /etc/qurl/proxy.yaml") {
		t.Error("missing or incorrect ExecStart")
	}

	// Check Environment with token.
	if !strings.Contains(result, "Environment=LAYERV_TOKEN=my-secret-token") {
		t.Error("missing Environment with token")
	}

	// Check restart settings.
	if !strings.Contains(result, "Restart=always") {
		t.Error("missing Restart=always")
	}
	if !strings.Contains(result, "RestartSec=5") {
		t.Error("missing RestartSec=5")
	}

	// Check dependencies.
	if !strings.Contains(result, "After=network-online.target") {
		t.Error("missing After=network-online.target")
	}
	if !strings.Contains(result, "WantedBy=multi-user.target") {
		t.Error("missing WantedBy=multi-user.target")
	}
}

func TestRenderSystemdUnit_WithoutToken(t *testing.T) {
	data := systemdUnitData{
		BinaryPath: "/usr/local/bin/qurl-frpc",
		ConfigPath: "/etc/qurl/proxy.yaml",
		Token:      "",
	}

	result, err := RenderSystemdUnit(data)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Environment line should NOT be present.
	if strings.Contains(result, "Environment=") {
		t.Error("Environment line should not be present when token is empty")
	}
	if strings.Contains(result, "LAYERV_TOKEN") {
		t.Error("LAYERV_TOKEN should not be present when token is empty")
	}

	// ExecStart should still be present.
	if !strings.Contains(result, "ExecStart=/usr/local/bin/qurl-frpc run --config /etc/qurl/proxy.yaml") {
		t.Error("missing ExecStart")
	}
}

func TestLaunchdPlistPath(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("launchd path test only runs on macOS")
	}

	path, err := LaunchdPlistPath()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	home, _ := os.UserHomeDir()
	expected := filepath.Join(home, "Library", "LaunchAgents", "ai.layerv.qurl-frpc.plist")
	if path != expected {
		t.Errorf("expected %s, got %s", expected, path)
	}
}

func TestLaunchdLogDir(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("launchd log dir test only runs on macOS")
	}

	dir, err := LaunchdLogDir()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	home, _ := os.UserHomeDir()
	expected := filepath.Join(home, "Library", "Logs", "qurl")
	if dir != expected {
		t.Errorf("expected %s, got %s", expected, dir)
	}
}

func TestSystemdUnitPath_System(t *testing.T) {
	path, err := SystemdUnitPath(false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "/etc/systemd/system/qurl-frpc.service"
	if path != expected {
		t.Errorf("expected %s, got %s", expected, path)
	}
}

func TestSystemdUnitPath_User(t *testing.T) {
	path, err := SystemdUnitPath(true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	home, _ := os.UserHomeDir()
	expected := filepath.Join(home, ".config", "systemd", "user", "qurl-frpc.service")
	if path != expected {
		t.Errorf("expected %s, got %s", expected, path)
	}
}
