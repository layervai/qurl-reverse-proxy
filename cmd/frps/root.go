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

	"github.com/OpenNHP/nhp-frp/pkg/banner"
	nhpversion "github.com/OpenNHP/nhp-frp/pkg/version"
)

var (
	cfgFile          string
	showVersion      bool
	strictConfigMode bool
	allowUnsafe      []string

	serverCfg v1.ServerConfig
)

func init() {
	rootCmd.PersistentFlags().StringVarP(&cfgFile, "config", "c", "", "config file of frps")
	rootCmd.PersistentFlags().BoolVarP(&showVersion, "version", "v", false, "version of frps")
	rootCmd.PersistentFlags().BoolVarP(&strictConfigMode, "strict_config", "", true, "strict config parsing mode, unknown fields will cause errors")
	rootCmd.PersistentFlags().StringSliceVarP(&allowUnsafe, "allow-unsafe", "", []string{},
		fmt.Sprintf("allowed unsafe features, one or more of: %s", strings.Join(security.ServerUnsafeFeatures, ", ")))

	config.RegisterServerConfigFlags(rootCmd, &serverCfg)
}

var rootCmd = &cobra.Command{
	Use:   "nhp-frps",
	Short: "nhp-frps is the server of nhp-frp (https://github.com/OpenNHP/nhp-frp)",
	RunE: func(cmd *cobra.Command, args []string) error {
		banner.Print("server")

		if showVersion {
			fmt.Println(nhpversion.Full())
			return nil
		}

		// Set binary directory for config template (e.g., log path)
		if exePath, err := os.Executable(); err == nil {
			binDir := filepath.ToSlash(filepath.Dir(exePath))
			config.GetValues().Envs["NHP_BIN_DIR"] = binDir

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

func runServer(cfg *v1.ServerConfig) error {
	log.InitLogger(cfg.Log.To, cfg.Log.Level, int(cfg.Log.MaxDays), cfg.Log.DisablePrintColor)

	if cfgFile != "" {
		log.Infof("frps uses config file: %s", cfgFile)
	} else {
		log.Infof("frps uses command line arguments for config")
	}

	svr, err := server.NewService(cfg)
	if err != nil {
		return err
	}
	log.Infof("frps started successfully")
	svr.Run(context.Background())
	return nil
}
