package service

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"text/template"
)

const launchdLabel = "ai.layerv.qurl-frpc"

const launchdPlistTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.layerv.qurl-frpc</string>
    <key>ProgramArguments</key>
    <array>
        <string>{{.BinaryPath}}</string>
        <string>run</string>
        <string>--config</string>
        <string>{{.ConfigPath}}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{{.LogDir}}/qurl-frpc.log</string>
    <key>StandardErrorPath</key>
    <string>{{.LogDir}}/qurl-frpc.err</string>
    {{- if .Token}}
    <key>EnvironmentVariables</key>
    <dict>
        <key>LAYERV_TOKEN</key>
        <string>{{.Token}}</string>
    </dict>
    {{- end}}
</dict>
</plist>
`

const systemdUnitName = "qurl-frpc.service"

const systemdUnitTemplate = `[Unit]
Description=QURL Reverse Proxy Client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={{.BinaryPath}} run --config {{.ConfigPath}}
Restart=always
RestartSec=5
{{- if .Token}}
Environment=LAYERV_TOKEN={{.Token}}
{{- end}}

[Install]
WantedBy=multi-user.target
`

// launchdPlistData holds the template data for rendering a launchd plist.
type launchdPlistData struct {
	BinaryPath string
	ConfigPath string
	LogDir     string
	Token      string
}

// systemdUnitData holds the template data for rendering a systemd unit file.
type systemdUnitData struct {
	BinaryPath string
	ConfigPath string
	Token      string
}

// RenderLaunchdPlist renders the launchd plist XML from the given data.
func RenderLaunchdPlist(data launchdPlistData) (string, error) {
	tmpl, err := template.New("plist").Parse(launchdPlistTemplate)
	if err != nil {
		return "", fmt.Errorf("parsing plist template: %w", err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("rendering plist template: %w", err)
	}
	return buf.String(), nil
}

// RenderSystemdUnit renders the systemd unit file content from the given data.
func RenderSystemdUnit(data systemdUnitData) (string, error) {
	tmpl, err := template.New("unit").Parse(systemdUnitTemplate)
	if err != nil {
		return "", fmt.Errorf("parsing systemd unit template: %w", err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("rendering systemd unit template: %w", err)
	}
	return buf.String(), nil
}

// LaunchdPlistPath returns the path to the launchd plist file for user-level installation.
func LaunchdPlistPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("getting home directory: %w", err)
	}
	return filepath.Join(home, "Library", "LaunchAgents", launchdLabel+".plist"), nil
}

// LaunchdLogDir returns the log directory for the launchd service.
func LaunchdLogDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("getting home directory: %w", err)
	}
	return filepath.Join(home, "Library", "Logs", "qurl"), nil
}

// SystemdUnitPath returns the path to the systemd unit file.
// If userLevel is true, returns the user-level path; otherwise system-level.
func SystemdUnitPath(userLevel bool) (string, error) {
	if userLevel {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("getting home directory: %w", err)
		}
		return filepath.Join(home, ".config", "systemd", "user", systemdUnitName), nil
	}
	return filepath.Join("/etc", "systemd", "system", systemdUnitName), nil
}
