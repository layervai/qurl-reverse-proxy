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

	"github.com/OpenNHP/nhp-frp/pkg/version"
	_ "github.com/OpenNHP/nhp-frp/web/frpc" // register embedded admin dashboard assets
	"github.com/OpenNHP/opennhp/endpoints/agent"
	"github.com/fatedier/frp/cmd/frpc/sub"
	frpconfig "github.com/fatedier/frp/pkg/config"
	"github.com/fatedier/frp/pkg/util/system"
)

const (
	colorReset  = "\033[0m"
	colorGreen  = "\033[32m"
	colorYellow = "\033[33m"
	colorCyan   = "\033[36m"
	colorBold   = "\033[1m"
)

func printBanner() {
	banner := `
  _   _ _   _ ____        _____ ____  ____
 | \ | | | | |  _ \      |  ___|  _ \|  _ \
 |  \| | |_| | |_) |_____| |_  | |_) | |_) |
 | |\  |  _  |  __/______|  _| |  _ <|  __/
 |_| \_|_| |_|_|         |_|   |_| \_\_|
`
	fmt.Printf("%s%s%s%s", colorBold, colorCyan, banner, colorReset)
	fmt.Printf("  %s%s (client)%s\n\n", colorGreen, version.Short(), colorReset)
}

// getMachineID returns a short unique identifier for the current machine
func getMachineID() string {
	id, err := machineid.ProtectedID("nhp-frp")
	if err != nil {
		return "unknown"
	}
	return id[:8]
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

	a := &agent.UdpAgent{}

	err = a.Start(exeDirPath, 4)
	if err != nil {
		fmt.Printf("\n  %s❌ Failed to start agent:%s %v\n\n", colorYellow, colorReset, err)
		waitCh <- err
		return
	}

	a.StartKnockLoop()
	// react to terminate signals
	termCh := make(chan os.Signal, 1)
	signal.Notify(termCh, syscall.SIGTERM, os.Interrupt, syscall.SIGABRT)

	// block until terminated
	waitCh <- nil
	<-termCh

	fmt.Printf("\n  %s🛑 Shutting down agent...%s\n", colorYellow, colorReset)
	a.Stop()
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
	printBanner()

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

	// Print config portal URL from frpc config
	if cfgFile := getConfigFile(); cfgFile != "" {
		printConfigPortal(cfgFile, machineID)
	}

	// Start built-in HTTP server for static files
	exePath, _ := os.Executable()
	publicDir := filepath.Join(filepath.Dir(exePath), "public")
	if info, err := os.Stat(publicDir); err == nil && info.IsDir() {
		startHTTPServer(publicDir)
	} else {
		fmt.Printf("  %sWarning: public directory not found at %s, HTTP server not started%s\n", colorYellow, publicDir, colorReset)
	}

	// Ensure FRP uses the same config file we resolved
	cfgFile := getConfigFile()
	hasCFlag := false
	for _, arg := range os.Args {
		if arg == "-c" || arg == "--config" {
			hasCFlag = true
			break
		}
	}
	if !hasCFlag {
		os.Args = append(os.Args, "-c", cfgFile)
	}

	system.EnableCompatibilityMode()
	sub.Execute()
}
