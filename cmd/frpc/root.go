package main

import (
	"fmt"
	"os"

	"github.com/fatedier/frp/pkg/config"
	"github.com/spf13/cobra"
)

var (
	cfgFile string
	token   string
)

var rootCmd = &cobra.Command{
	Use:   "qurl-frpc",
	Short: "QURL reverse proxy client",
	// When no subcommand is given, delegate to runCmd for backward compatibility.
	RunE: func(cmd *cobra.Command, args []string) error {
		return runCmd.RunE(cmd, args)
	},
}

func init() {
	rootCmd.PersistentFlags().StringVarP(&cfgFile, "config", "c", "", "path to config file")
	rootCmd.PersistentFlags().StringVar(&token, "token", "",
		"API token for authentication (env: LAYERV_TOKEN). Accepts an OAuth access token or a QURL API key (prefixed lv_live_ for production, lv_test_ for staging)")

	rootCmd.AddCommand(runCmd)
	rootCmd.AddCommand(versionCmd)
	rootCmd.AddCommand(addCmd)
	rootCmd.AddCommand(installServiceCmd)
	rootCmd.AddCommand(uninstallServiceCmd)
	rootCmd.AddCommand(statusCmd)
}

// getToken returns the API token from the --token flag or LAYERV_TOKEN env var.
// The token may be an OAuth access token or a QURL API key (lv_live_* / lv_test_*).
func getToken() string {
	if token != "" {
		return token
	}
	return os.Getenv("LAYERV_TOKEN")
}

// getAPIBaseURL returns the QURL API base URL from env or default.
func getAPIBaseURL() string {
	if u := os.Getenv("QURL_API_URL"); u != "" {
		return u
	}
	return "https://api.layerv.ai/v1"
}

// Execute runs the root command.
func Execute() {
	rootCmd.SetGlobalNormalizationFunc(config.WordSepNormalizeFunc)
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
