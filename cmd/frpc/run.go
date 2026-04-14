package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/denisbrodbeck/machineid"
	"github.com/spf13/cobra"

	"github.com/layervai/qurl-reverse-proxy/pkg/apiclient"
	"github.com/layervai/qurl-reverse-proxy/pkg/config"
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

	exeBinDir := "."
	if ep, err := os.Executable(); err == nil {
		exeBinDir = filepath.ToSlash(filepath.Dir(ep))
	}
	machineID := getMachineID()

	// Inject into FRP's env map for legacy TOML template support.
	frpconfig.GetValues().Envs["QURL_MACHINE_ID"] = machineID
	frpconfig.GetValues().Envs["QURL_BIN_DIR"] = exeBinDir
	fmt.Printf("  Machine ID: %s%s%s\n", colorCyan, machineID, colorReset)

	// Start NHP agent only if its config exists (optional for basic tunnel mode).
	nhpConfigPath := filepath.Join(exeBinDir, "etc", "config.toml")
	if _, err := os.Stat(nhpConfigPath); err == nil {
		waitCh := make(chan error)
		go nhpAgentStart(waitCh)
		if err := <-waitCh; err != nil {
			fmt.Printf("  %sNHP agent failed (continuing without NHP): %v%s\n", colorYellow, err, colorReset)
		} else {
			fmt.Printf("  NHP agent started successfully\n")
		}
	} else {
		fmt.Printf("  %sNHP agent skipped (no config at %s)%s\n", colorYellow, nhpConfigPath, colorReset)
	}

	// Discover config: --config flag > qurl-proxy.yaml > legacy frpc.toml
	cfgPath, isLegacy, err := config.Discover(cfgFile)
	if err != nil {
		// No config found anywhere — check for legacy default path
		legacyPath := filepath.Join(exeBinDir, "etc", "frpc.toml")
		if _, statErr := os.Stat(legacyPath); statErr == nil {
			cfgPath = legacyPath
			isLegacy = true
		} else {
			return fmt.Errorf("no config found. Create qurl-proxy.yaml or use --config flag.\nRun 'qurl-frpc add --target http://localhost:8080 --name myapp' to get started.")
		}
	}

	fmt.Printf("  Config: %s%s%s\n", colorCyan, cfgPath, colorReset)

	// Legacy TOML path — delegate to FRP's own Cobra command
	if isLegacy {
		return startFRPLegacy(cfgPath)
	}

	// YAML config path — load, generate FRP config, start directly
	return startFRPFromYAML(cfgPath, machineID)
}

// startFRPFromYAML loads the QURL YAML config, generates FRP types, and starts the client.
func startFRPFromYAML(cfgPath string, machineID string) error {
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	if cfg.Server.Addr == "" {
		return fmt.Errorf("server.addr not configured in %s. Set the QURL proxy server address.", cfgPath)
	}

	if len(cfg.Routes) == 0 {
		return fmt.Errorf("no routes configured. Run 'qurl-frpc add' to register services first.")
	}

	// Generate FRP client config from YAML routes
	common, proxyCfgs, visitorCfgs, err := config.GenerateFRPClientConfig(cfg, machineID)
	if err != nil {
		return fmt.Errorf("generating FRP config: %w", err)
	}

	// Enable the admin web server for hot-reload support
	common.WebServer.Addr = "127.0.0.1"
	common.WebServer.Port = 7400
	common.WebServer.User = "admin"
	common.WebServer.Password = machineID

	// Set auth
	if cfg.Server.Token != "" {
		common.Auth.Method = v1.AuthMethod("token")
		common.Auth.Token = cfg.Server.Token
	}

	// Set log level
	common.Log.Level = logLevel

	// Complete config defaults (required before FRP validation)
	if err := common.Complete(); err != nil {
		return fmt.Errorf("completing config: %w", err)
	}
	for _, pc := range proxyCfgs {
		pc.Complete(common.Auth.Token)
	}
	warning, valErr := validation.ValidateAllClientConfig(common, proxyCfgs, visitorCfgs, nil)
	if warning != nil {
		fmt.Printf("  %sWarning: %v%s\n", colorYellow, warning, colorReset)
	}
	if valErr != nil {
		return fmt.Errorf("config validation: %w", valErr)
	}

	fmt.Printf("  %s%d route(s) configured%s\n", colorGreen, len(cfg.Routes), colorReset)
	for _, r := range cfg.Routes {
		target := fmt.Sprintf("%s:%d", r.LocalIP, r.LocalPort)
		fmt.Printf("    %s → %s (%s)%s\n", colorCyan, target, r.Name, colorReset)
	}
	fmt.Printf("  %sAdmin API at http://127.0.0.1:7400%s\n\n", colorGreen, colorReset)

	return startService(common, proxyCfgs, visitorCfgs, cfgPath)
}

const heartbeatInterval = 30 * time.Second

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

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start heartbeat goroutine if API token is available
	if tok := getToken(); tok != "" {
		machineID := getMachineID()
		apiClient := apiclient.New(getAPIBaseURL(), tok)
		go runHeartbeat(ctx, apiClient, machineID)
	}

	// Graceful shutdown on SIGINT/SIGTERM for all transport protocols.
	go func() {
		ch := make(chan os.Signal, 1)
		signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
		<-ch
		cancel()
		svr.GracefulClose(500 * time.Millisecond)
	}()
	return svr.Run(ctx)
}

// runHeartbeat sends periodic heartbeats to the QURL API.
func runHeartbeat(ctx context.Context, client *apiclient.Client, machineID string) {
	startTime := time.Now()
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	// Send initial heartbeat immediately
	sendHeartbeat(ctx, client, machineID, startTime)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sendHeartbeat(ctx, client, machineID, startTime)
		}
	}
}

func sendHeartbeat(ctx context.Context, client *apiclient.Client, machineID string, startTime time.Time) {
	uptime := int64(time.Since(startTime).Seconds())
	status := probeAdminStatus()
	if err := client.Heartbeat(ctx, &apiclient.HeartbeatRequest{
		ConnectorID: machineID,
		MachineID:   machineID,
		Uptime:      uptime,
		Status:      status,
	}); err != nil {
		log.Warnf("heartbeat failed: %v", err)
	}
}

// probeAdminStatus queries the local FRP admin API to determine tunnel connection state.
// Returns "connected" if any proxy is running, "reconnecting" if proxies exist but none
// are running, or "starting" if the admin API is not yet reachable.
func probeAdminStatus() string {
	adminURL := fmt.Sprintf("http://%s:%d/api/status", "127.0.0.1", 7400)
	httpClient := &http.Client{Timeout: 2 * time.Second}
	req, err := http.NewRequest("GET", adminURL, nil)
	if err != nil {
		return "starting"
	}
	req.SetBasicAuth("admin", getMachineID())

	resp, err := httpClient.Do(req)
	if err != nil {
		return "starting"
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "starting"
	}

	// FRP admin API returns {"tcp": [...], "http": [...], ...} where each proxy
	// has a "status" field of "running", "new", "wait start", "check failed", etc.
	var statusMap map[string][]struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(body, &statusMap); err != nil {
		return "starting"
	}

	hasProxy := false
	for _, proxies := range statusMap {
		for _, p := range proxies {
			hasProxy = true
			if p.Status == "running" {
				return "connected"
			}
		}
	}
	if hasProxy {
		return "reconnecting"
	}
	return "starting"
}

// startFRPLegacy delegates to FRP's built-in Cobra for legacy TOML configs.
func startFRPLegacy(cfgPath string) error {
	os.Args = []string{os.Args[0], "-c", cfgPath}
	sub.Execute()
	return nil
}

func printBanner() {
	banner := `
   ___  _   _ ____  _
  / _ \| | | |  _ \| |
 | | | | | | | |_) | |
 | |_| | |_| |  _ <| |___
  \__\_\\___/|_| \_\_____|  Reverse Proxy
`
	fmt.Printf("%s%s%s%s", colorBold, colorCyan, banner, colorReset)
	fmt.Printf("  %s%s (client)%s\n\n", colorGreen, version.Short(), colorReset)
}

func getMachineID() string {
	id, err := machineid.ProtectedID("qurl-frp")
	if err != nil {
		return "unknown"
	}
	return id[:8]
}

func getConfigFile() string {
	if cfgFile != "" {
		return cfgFile
	}
	exePath, err := os.Executable()
	if err != nil {
		return ""
	}
	return filepath.Join(filepath.Dir(exePath), "etc", "frpc.toml")
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
		waitCh <- err
		return
	}

	a.StartKnockLoop()
	termCh := make(chan os.Signal, 1)
	signal.Notify(termCh, syscall.SIGTERM, os.Interrupt, syscall.SIGABRT)

	waitCh <- nil
	<-termCh

	a.Stop()
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
