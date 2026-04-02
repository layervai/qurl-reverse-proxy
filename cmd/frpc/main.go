// Copyright 2016 fatedier, fatedier@gmail.com
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package main

import (
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/denisbrodbeck/machineid"
	toml "github.com/pelletier/go-toml/v2"

	"github.com/OpenNHP/nhp-frp/pkg/banner"
	_ "github.com/OpenNHP/nhp-frp/web/frpc" // register embedded admin dashboard assets
	"github.com/OpenNHP/opennhp/endpoints/agent"
	"github.com/fatedier/frp/cmd/frpc/sub"
	frpconfig "github.com/fatedier/frp/pkg/config"
	"github.com/fatedier/frp/pkg/util/system"
)

const (
	colorReset  = banner.ColorReset
	colorGreen  = banner.ColorGreen
	colorYellow = banner.ColorYellow
	colorCyan   = banner.ColorCyan
)

// getMachineID returns a short unique identifier for the current machine
func getMachineID() string {
	id, err := machineid.ProtectedID("nhp-frp")
	if err != nil {
		return "unknown"
	}
	return id[:8]
}

// hasConfigFlag returns true if -c or --config was passed on the command line.
func hasConfigFlag() bool {
	for _, arg := range os.Args {
		if arg == "-c" || arg == "--config" {
			return true
		}
	}
	return false
}

// getConfigFile returns the config file path from -c flag or defaults to "<binary_dir>/etc/frpc.toml"
func getConfigFile() string {
	for i, arg := range os.Args {
		if (arg == "-c" || arg == "--config") && i+1 < len(os.Args) {
			return os.Args[i+1]
		}
	}
	exePath, err := os.Executable()
	if err != nil {
		return "./frpc.toml"
	}
	return filepath.Join(filepath.Dir(exePath), "etc", "frpc.toml")
}

// printConfigPortal reads the webServer settings from config and prints the portal URL
func printConfigPortal(cfgFile string, machineID string) {
	data, err := os.ReadFile(cfgFile)
	if err != nil {
		return
	}

	// Use a permissive map to avoid template syntax errors in TOML parsing
	var raw map[string]interface{}
	if err := toml.Unmarshal(data, &raw); err != nil {
		return
	}

	// Print config portal URL
	if ws, ok := raw["webServer"].(map[string]interface{}); ok {
		addr, _ := ws["addr"].(string)
		if addr == "" || addr == "0.0.0.0" {
			addr = "127.0.0.1"
		}
		var port int64
		if p, ok := ws["port"].(int64); ok {
			port = p
		}
		if port > 0 {
			fmt.Printf("  %sConfig portal available at http://%s:%d%s\n", colorGreen, addr, port, colorReset)
		}
	}

	// Print public URL and admin API URL with machine ID subdomain (read from nhp-frpc.toml)
	nhpCfgFile := filepath.Join(filepath.Dir(cfgFile), "nhp-frpc.toml")
	if nhpData, err := os.ReadFile(nhpCfgFile); err == nil {
		var nhpCfg map[string]interface{}
		if err := toml.Unmarshal(nhpData, &nhpCfg); err == nil {
			if subDomainHost, ok := nhpCfg["subDomainHost"].(string); ok && subDomainHost != "" && machineID != "unknown" {
				portSuffix := ""
				if p, ok := nhpCfg["vhostHTTPPort"].(int64); ok && p != 0 && p != 80 {
					portSuffix = fmt.Sprintf(":%d", p)
				}
				fmt.Printf("  %sPublic URL: http://%s.%s%s%s\n", colorGreen, machineID, subDomainHost, portSuffix, colorReset)
				fmt.Printf("  %sAdmin  API: http://%s-admin.%s%s%s (user: admin, password: %s)\n", colorGreen, machineID, subDomainHost, portSuffix, colorReset, machineID)
			}
		}
	}
}

func nhpAgentStart(waitCh chan error) {
	exeFilePath, err := os.Executable()
	if err != nil {
		waitCh <- err
		return
	}
	exeDirPath := filepath.Dir(exeFilePath)

	udpAgent := &agent.UdpAgent{}

	err = udpAgent.Start(exeDirPath, 4)
	if err != nil {
		fmt.Printf("\n  %s❌ Failed to start agent:%s %v\n\n", colorYellow, colorReset, err)
		waitCh <- err
		return
	}

	udpAgent.StartKnockLoop()

	termCh := make(chan os.Signal, 1)
	signal.Notify(termCh, syscall.SIGTERM, os.Interrupt, syscall.SIGABRT)

	waitCh <- nil
	<-termCh

	fmt.Printf("\n  %s🛑 Shutting down agent...%s\n", colorYellow, colorReset)
	udpAgent.Stop()
	fmt.Printf("  %s✅ Agent stopped gracefully%s\n\n", colorGreen, colorReset)

	// Exit the entire process since sub.Execute() doesn't handle signals
	os.Exit(0)
}

func startHTTPServer(publicDir string) {
	fs := http.FileServer(http.Dir(publicDir))
	mux := http.NewServeMux()
	mux.Handle("/", fs)

	addr := ":8888"
	fmt.Printf("  %sFile server listening on %s (serving %s)%s\n", colorGreen, addr, publicDir, colorReset)
	go func() {
		if err := http.ListenAndServe(addr, mux); err != nil {
			fmt.Printf("  %sHTTP server error: %v%s\n", colorYellow, err, colorReset)
		}
	}()
}

func main() {
	banner.Print("client")

	// Set binary directory and machine ID for FRP config template
	exeBinDir := "."
	if ep, err := os.Executable(); err == nil {
		exeBinDir = filepath.ToSlash(filepath.Dir(ep))
	}
	machineID := getMachineID()

	// Inject into FRP's cached env map (populated at init time, before os.Setenv)
	frpconfig.GetValues().Envs["NHP_MACHINE_ID"] = machineID
	frpconfig.GetValues().Envs["NHP_BIN_DIR"] = exeBinDir
	fmt.Printf("  Machine ID: %s%s%s\n", colorCyan, machineID, colorReset)

	waitCh := make(chan error)
	go nhpAgentStart(waitCh)
	err := <-waitCh
	if err != nil {
		fmt.Printf("nhp agent start error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("  nhp agent started successfully\n")

	// Resolve config file once and ensure FRP uses it
	cfgFile := getConfigFile()
	printConfigPortal(cfgFile, machineID)
	if !hasConfigFlag() {
		os.Args = append(os.Args, "-c", cfgFile)
	}

	// Start built-in HTTP server for static files
	publicDir := filepath.Join(exeBinDir, "public")
	if info, err := os.Stat(publicDir); err == nil && info.IsDir() {
		startHTTPServer(publicDir)
	} else {
		fmt.Printf("  %sWarning: public directory not found at %s, HTTP server not started%s\n", colorYellow, publicDir, colorReset)
	}

	system.EnableCompatibilityMode()
	sub.Execute()
}
