// Copyright 2018 fatedier, fatedier@gmail.com
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
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"github.com/fatedier/frp/pkg/config"
	v1 "github.com/fatedier/frp/pkg/config/v1"
	"github.com/fatedier/frp/pkg/config/v1/validation"
	"github.com/fatedier/frp/pkg/policy/security"
	"github.com/fatedier/frp/pkg/util/log"
	"github.com/fatedier/frp/server"

	"github.com/layervai/qurl-reverse-proxy/pkg/apiclient"
	"github.com/layervai/qurl-reverse-proxy/pkg/tunnelauth"
	nhpversion "github.com/layervai/qurl-reverse-proxy/pkg/version"
)

const (
	colorReset = "\033[0m"
	colorGreen = "\033[32m"
	colorCyan  = "\033[36m"
	colorBold  = "\033[1m"
)

var (
	cfgFile          string
	showVersion      bool
	strictConfigMode bool
	allowUnsafe      []string

	serverCfg v1.ServerConfig
)

func printBanner() {
	banner := `
   ___  _   _ ____  _
  / _ \| | | |  _ \| |
 | | | | | | | |_) | |
 | |_| | |_| |  _ <| |___
  \__\_\\___/|_| \_\_____|  Reverse Proxy
`
	fmt.Printf("%s%s%s%s", colorBold, colorCyan, banner, colorReset)
	fmt.Printf("  %s%s (server)%s\n\n", colorGreen, nhpversion.Short(), colorReset)
}

func init() {
	rootCmd.PersistentFlags().StringVarP(&cfgFile, "config", "c", "", "config file of frps")
	rootCmd.PersistentFlags().BoolVarP(&showVersion, "version", "v", false, "version of frps")
	rootCmd.PersistentFlags().BoolVarP(&strictConfigMode, "strict_config", "", true, "strict config parsing mode, unknown fields will cause errors")
	rootCmd.PersistentFlags().StringSliceVarP(&allowUnsafe, "allow-unsafe", "", []string{},
		fmt.Sprintf("allowed unsafe features, one or more of: %s", strings.Join(security.ServerUnsafeFeatures, ", ")))

	config.RegisterServerConfigFlags(rootCmd, &serverCfg)
}

var rootCmd = &cobra.Command{
	Use:   "qurl-frps",
	Short: "qurl-frps is the server of QURL Reverse Proxy (https://github.com/layervai/qurl-reverse-proxy)",
	RunE: func(cmd *cobra.Command, args []string) error {
		printBanner()

		if showVersion {
			fmt.Println(nhpversion.Full())
			return nil
		}

		// Set binary directory for config template (e.g., log path)
		if exePath, err := os.Executable(); err == nil {
			binDir := filepath.ToSlash(filepath.Dir(exePath))
			config.GetValues().Envs["QURL_BIN_DIR"] = binDir

			// Default config path: <binary_dir>/etc/frps.toml
			if cfgFile == "" {
				defaultCfg := filepath.Join(binDir, "etc", "frps.toml")
				if _, err := os.Stat(defaultCfg); err == nil {
					cfgFile = defaultCfg
				}
			}
		}

		var (
			svrCfg         *v1.ServerConfig
			isLegacyFormat bool
			err            error
		)
		if cfgFile != "" {
			svrCfg, isLegacyFormat, err = config.LoadServerConfig(cfgFile, strictConfigMode)
			if err != nil {
				fmt.Println(err)
				os.Exit(1)
			}
			if isLegacyFormat {
				fmt.Printf("WARNING: ini format is deprecated and the support will be removed in the future, " +
					"please use yaml/json/toml format instead!\n")
			}
		} else {
			if err := serverCfg.Complete(); err != nil {
				fmt.Printf("failed to complete server config: %v\n", err)
				os.Exit(1)
			}
			svrCfg = &serverCfg
		}

		unsafeFeatures := security.NewUnsafeFeatures(allowUnsafe)
		validator := validation.NewConfigValidator(unsafeFeatures)
		warning, err := validator.ValidateServerConfig(svrCfg)
		if warning != nil {
			fmt.Printf("WARNING: %v\n", warning)
		}
		if err != nil {
			fmt.Println(err)
			os.Exit(1)
		}

		if err := runServer(svrCfg); err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		return nil
	},
}

func Execute() {
	rootCmd.SetGlobalNormalizationFunc(config.WordSepNormalizeFunc)
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

const tunnelAuthAddr = "127.0.0.1:7600"

func runServer(cfg *v1.ServerConfig) (err error) {
	log.InitLogger(cfg.Log.To, cfg.Log.Level, int(cfg.Log.MaxDays), cfg.Log.DisablePrintColor)

	if cfgFile != "" {
		log.Infof("frps uses config file: %s", cfgFile)
	} else {
		log.Infof("frps uses command line arguments for config")
	}

	// Start tunnel auth plugin if QURL API credentials are configured.
	authCleanup, err := startTunnelAuth(cfg)
	if err != nil {
		return fmt.Errorf("tunnel auth: %w", err)
	}
	if authCleanup != nil {
		defer authCleanup()
	}

	svr, err := server.NewService(cfg)
	if err != nil {
		return err
	}
	log.Infof("frps started successfully")
	svr.Run(context.Background())
	return
}

// startTunnelAuth sets up the tunnel auth resilience layer if QURL_API_URL
// and QURL_API_TOKEN are set. It starts a local HTTP server that FRP calls
// as a server plugin for NewProxy events. Returns a cleanup function and
// any error. Returns (nil, nil) if the env vars are not set (auth disabled).
func startTunnelAuth(cfg *v1.ServerConfig) (cleanup func(), err error) {
	apiURL := os.Getenv("QURL_API_URL")
	apiToken := os.Getenv("QURL_API_TOKEN")
	if apiURL == "" || apiToken == "" {
		log.Infof("tunnel auth disabled (QURL_API_URL or QURL_API_TOKEN not set)")
		return nil, nil
	}

	logger := slog.Default()
	client := apiclient.New(apiURL, apiToken)
	authorizer := tunnelauth.New(client, tunnelauth.WithLogger(logger))
	handler := tunnelauth.NewHandler(authorizer, logger)

	mux := http.NewServeMux()
	mux.Handle("/internal/v1/tunnel/auth", handler)

	ln, err := net.Listen("tcp", tunnelAuthAddr)
	if err != nil {
		return nil, fmt.Errorf("listen %s: %w", tunnelAuthAddr, err)
	}

	srv := &http.Server{Handler: mux}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Warnf("tunnel auth server error: %v", err)
		}
	}()

	// Register the plugin with FRP's server config.
	cfg.HTTPPlugins = append(cfg.HTTPPlugins, v1.HTTPPluginOptions{
		Name: "tunnel-auth",
		Addr: tunnelAuthAddr,
		Path: "/internal/v1/tunnel/auth",
		Ops:  []string{"NewProxy"},
	})

	log.Infof("tunnel auth enabled at %s (api: %s)", tunnelAuthAddr, apiURL)

	return func() {
		authorizer.Close()
		srv.Close()
	}, nil
}
