package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"github.com/layervai/qurl-reverse-proxy/pkg/service"
)

var installServiceCmd = &cobra.Command{
	Use:   "install-service",
	Short: "Install qurl-frpc as an OS background service",
	RunE: func(cmd *cobra.Command, args []string) error {
		binaryPath, err := os.Executable()
		if err != nil {
			return fmt.Errorf("cannot determine binary path: %w", err)
		}
		binaryPath, err = filepath.EvalSymlinks(binaryPath)
		if err != nil {
			return fmt.Errorf("cannot resolve binary path: %w", err)
		}

		configPath := cfgFile
		if configPath == "" {
			binDir := filepath.Dir(binaryPath)
			for _, name := range []string{"qurl-proxy.yaml", "frpc.toml"} {
				candidate := filepath.Join(binDir, "etc", name)
				if _, err := os.Stat(candidate); err == nil {
					configPath = candidate
					break
				}
			}
		}
		if configPath == "" {
			return fmt.Errorf("cannot find config file; use --config to specify")
		}

		tkn := token
		if tkn == "" {
			tkn = os.Getenv("LAYERV_TOKEN")
		}

		userLevel, _ := cmd.Flags().GetBool("user")

		cfg := service.Config{
			BinaryPath: binaryPath,
			ConfigPath: configPath,
			Token:      tkn,
			UserLevel:  userLevel,
		}

		mgr := service.New()
		if err := mgr.Install(cfg); err != nil {
			return fmt.Errorf("installing service: %w", err)
		}

		fmt.Println("Service installed and started successfully.")
		fmt.Printf("  Binary: %s\n", binaryPath)
		fmt.Printf("  Config: %s\n", configPath)
		if tkn != "" {
			fmt.Println("  Token:  (set)")
		}
		return nil
	},
}

var uninstallServiceCmd = &cobra.Command{
	Use:   "uninstall-service",
	Short: "Uninstall qurl-frpc background service",
	RunE: func(cmd *cobra.Command, args []string) error {
		mgr := service.New()
		if err := mgr.Uninstall(); err != nil {
			return fmt.Errorf("uninstalling service: %w", err)
		}
		fmt.Println("Service uninstalled successfully.")
		return nil
	},
}

func init() {
	installServiceCmd.Flags().Bool("user", false, "Install as user-level service (no root/admin)")
}
