package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/denisbrodbeck/machineid"
	toml "github.com/pelletier/go-toml/v2"
	"github.com/spf13/cobra"

	"github.com/layervai/qurl-reverse-proxy/pkg/version"
	"github.com/OpenNHP/opennhp/endpoints/agent"
	"github.com/fatedier/frp/client"
	"github.com/fatedier/frp/cmd/frpc/sub"
	frpconfig "github.com/fatedier/frp/pkg/config"
	v1 "github.com/fatedier/frp/pkg/config/v1"
	"github.com/fatedier/frp/pkg/config/v1/validation"
	"github.com/fatedier/frp/pkg/policy/security"
	"github.com/fatedier/frp/pkg/util/log"
)

// ANSI color codes used for terminal output.
const (
	colorReset  = "\033[0m"
	colorGreen  = "\033[32m"
	colorYellow = "\033[33m"
	colorCyan   = "\033[36m"
	colorBold   = "\033[1m"
)

var (
	logLevel         string
	strictConfigMode bool
)

var runCmd = &cobra.Command{
	Use:   "run",
	Short: "Start proxy tunnels",
	RunE:  runCmdFunc,
}

func init() {
	runCmd.Flags().StringVar(&logLevel, "log-level", "info", "log level: trace, debug, info, warn, error")
	runCmd.Flags().BoolVar(&strictConfigMode, "strict-config", true, "strict config parsing mode, unknown fields cause errors")
}

func runCmdFunc(cmd *cobra.Command, args []string) error {
	printBanner()

	// Resolve binary directory and machine ID for FRP config templates.
	exeBinDir := "."
	if ep, err := os.Executable(); err == nil {
		exeBinDir = filepath.ToSlash(filepath.Dir(ep))
	}
	machineID := getMachineID()

	// Inject into FRP's cached env map (populated at init time, before os.Setenv).
	frpconfig.GetValues().Envs["NHP_MACHINE_ID"] = machineID
	frpconfig.GetValues().Envs["NHP_BIN_DIR"] = exeBinDir
	fmt.Printf("  Machine ID: %s%s%s\n", colorCyan, machineID, colorReset)

	// Start NHP agent.
	waitCh := make(chan error)
	go nhpAgentStart(waitCh)
	if err := <-waitCh; err != nil {
		fmt.Printf("nhp agent start error: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("  nhp agent started successfully\n")

	// Resolve config file: --config flag takes priority, then default discovery.
	cfgPath := getConfigFile()

	// Print config portal URL.
	if cfgPath != "" {
		printConfigPortal(cfgPath, machineID)
	}

	// Start built-in HTTP file server if a public/ directory exists.
	exePath, _ := os.Executable()
	publicDir := filepath.Join(filepath.Dir(exePath), "public")
	if info, err := os.Stat(publicDir); err == nil && info.IsDir() {
		startHTTPServer(publicDir)
	} else {
		fmt.Printf("  %sWarning: public directory not found at %s, HTTP server not started%s\n", colorYellow, publicDir, colorReset)
	}

	// Determine config type and start FRP accordingly.
	if cfgPath != "" && isYAMLConfig(cfgPath) {
		return startFRPFromYAML(cfgPath)
	}
	return startFRPLegacy(cfgPath)
}

// isYAMLConfig returns true if the config file has a YAML extension.
func isYAMLConfig(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".yaml" || ext == ".yml"
}

// startFRPFromYAML loads a YAML config and starts the FRP client service directly.
func startFRPFromYAML(cfgPath string) error {
	cfg, proxyCfgs, visitorCfgs, _, err := frpconfig.LoadClientConfig(cfgPath, strictConfigMode)
	if err != nil {
		return fmt.Errorf("failed to load YAML config: %w", err)
	}

	warning, err := validation.ValidateAllClientConfig(cfg, proxyCfgs, visitorCfgs, nil)
	if warning != nil {
		fmt.Printf("WARNING: %v\n", warning)
	}
	if err != nil {
		return fmt.Errorf("config validation failed: %w", err)
	}

	return startService(cfg, proxyCfgs, visitorCfgs, cfgPath)
}

// startService creates and runs the FRP client service.
func startService(
	cfg *v1.ClientCommonConfig,
	proxyCfgs []v1.ProxyConfigurer,
	visitorCfgs []v1.VisitorConfigurer,
	cfgPath string,
) error {
	log.InitLogger(cfg.Log.To, cfg.Log.Level, int(cfg.Log.MaxDays), cfg.Log.DisablePrintColor)

	if cfgPath != "" {
		log.Infof("start frpc service for config file [%s]", cfgPath)
		defer log.Infof("frpc service for config file [%s] stopped", cfgPath)
	}

	svr, err := client.NewService(client.ServiceOptions{
		Common:         cfg,
		ProxyCfgs:      proxyCfgs,
		VisitorCfgs:    visitorCfgs,
		UnsafeFeatures: &security.UnsafeFeatures{},
		ConfigFilePath: cfgPath,
	})
	if err != nil {
		return fmt.Errorf("failed to create FRP service: %w", err)
	}

	shouldGracefulClose := cfg.Transport.Protocol == "kcp" || cfg.Transport.Protocol == "quic"
	if shouldGracefulClose {
		go handleTermSignal(svr)
	}
	return svr.Run(context.Background())
}

// handleTermSignal waits for SIGINT/SIGTERM and gracefully shuts down the FRP client.
func handleTermSignal(svr *client.Service) {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
	<-ch
	svr.GracefulClose(500 * time.Millisecond)
}

// startFRPLegacy injects env vars and delegates to FRP's built-in sub.Execute for TOML configs.
func startFRPLegacy(cfgPath string) error {
	// Ensure FRP sees the resolved config path via its -c flag.
	hasCFlag := false
	for _, arg := range os.Args {
		if arg == "-c" || arg == "--config" {
			hasCFlag = true
			break
		}
	}
	if !hasCFlag && cfgPath != "" {
		os.Args = append(os.Args, "-c", cfgPath)
	}

	sub.Execute()
	return nil
}

func printBanner() {
	banner := `
  _   _ _   _ ____        _____ ____  ____
 | \ | | | | |  _ \      |  ___|  _ \|  _ \
 |  \| | |_| | |_) |_____|  _| | |_) | |_) |
 | |\  |  _  |  __/______|  _| |  _ <|  __/
 |_| \_|_| |_|_|         |_|   |_| \_\_|
`
	fmt.Printf("%s%s%s%s", colorBold, colorCyan, banner, colorReset)
	fmt.Printf("  %s%s (client)%s\n\n", colorGreen, version.Short(), colorReset)
}

// getMachineID returns a short unique identifier for the current machine.
func getMachineID() string {
	id, err := machineid.ProtectedID("nhp-frp")
	if err != nil {
		return "unknown"
	}
	return id[:8]
}

// getConfigFile resolves the config file path. The --config flag takes priority,
// otherwise it falls back to <binary_dir>/etc/frpc.toml.
func getConfigFile() string {
	if cfgFile != "" {
		return cfgFile
	}
	exePath, err := os.Executable()
	if err != nil {
		return "./frpc.toml"
	}
	return filepath.Join(filepath.Dir(exePath), "etc", "frpc.toml")
}

// printConfigPortal reads the webServer settings from config and prints the portal URL.
func printConfigPortal(cfgPath string, machineID string) {
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		return
	}

	// Use a permissive map to avoid template syntax errors in TOML parsing.
	var raw map[string]interface{}
	if err := toml.Unmarshal(data, &raw); err != nil {
		return
	}

	// Print config portal URL.
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

	// Print public URL and admin API URL with machine ID subdomain (read from nhp-frpc.toml).
	nhpCfgFile := filepath.Join(filepath.Dir(cfgPath), "nhp-frpc.toml")
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
	// React to terminate signals.
	termCh := make(chan os.Signal, 1)
	signal.Notify(termCh, syscall.SIGTERM, os.Interrupt, syscall.SIGABRT)

	// Block until terminated.
	waitCh <- nil
	<-termCh

	fmt.Printf("\n  %s🛑 Shutting down agent...%s\n", colorYellow, colorReset)
	a.Stop()
	fmt.Printf("  %s✅ Agent stopped gracefully%s\n\n", colorGreen, colorReset)

	// Exit the entire process since sub.Execute() doesn't handle signals.
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
