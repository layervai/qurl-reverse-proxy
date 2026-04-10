package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"

	"github.com/layervai/qurl-reverse-proxy/pkg/selfupdate"
	"github.com/layervai/qurl-reverse-proxy/pkg/version"
)

var (
	updateCheckOnly bool
	updateJSON      bool
)

var updateCmd = &cobra.Command{
	Use:   "update",
	Short: "Check for and apply updates",
	Long: `Check for new releases and optionally update in-place.

Examples:
  qurl-frpc update          Download and apply the latest version
  qurl-frpc update --check  Only check, don't download
  qurl-frpc update --json   Machine-readable output`,
	RunE: runUpdate,
}

func init() {
	updateCmd.Flags().BoolVar(&updateCheckOnly, "check", false, "only check for updates, don't apply")
	updateCmd.Flags().BoolVar(&updateJSON, "json", false, "output in JSON format")
}

type updateOutput struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Available bool   `json:"update_available"`
	Applied   bool   `json:"applied"`
	Error     string `json:"error,omitempty"`
}

func runUpdate(_ *cobra.Command, _ []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	u := &selfupdate.Updater{}

	if !updateJSON {
		fmt.Printf("  Checking for updates...\n")
	}

	info, err := u.CheckForUpdate(ctx, version.Version)
	if err != nil {
		if updateJSON {
			return outputJSON(updateOutput{
				Current: version.Version,
				Error:   err.Error(),
			})
		}
		return fmt.Errorf("check for updates: %w", err)
	}

	if !info.Available {
		if updateJSON {
			return outputJSON(updateOutput{
				Current:   info.CurrentVersion,
				Latest:    info.LatestVersion,
				Available: false,
			})
		}
		fmt.Printf("  Already up to date (%s%s%s)\n", colorGreen, info.CurrentVersion, colorReset)
		return nil
	}

	if updateCheckOnly {
		if updateJSON {
			return outputJSON(updateOutput{
				Current:   info.CurrentVersion,
				Latest:    info.LatestVersion,
				Available: true,
			})
		}
		fmt.Printf("  Update available: %s%s%s → %s%s%s\n",
			colorYellow, info.CurrentVersion, colorReset,
			colorGreen, info.LatestVersion, colorReset)
		fmt.Printf("  Release: %s\n", info.ReleaseURL)
		fmt.Printf("\n  Run %squrl-frpc update%s to install.\n", colorCyan, colorReset)
		return nil
	}

	if info.AssetURL == "" {
		if updateJSON {
			return outputJSON(updateOutput{
				Current:   info.CurrentVersion,
				Latest:    info.LatestVersion,
				Available: true,
				Error:     "no download available for this platform",
			})
		}
		fmt.Printf("  Update %s is available but no binary for this platform.\n", info.LatestVersion)
		fmt.Printf("  Download manually: %s\n", info.ReleaseURL)
		return nil
	}

	// Determine install directory from the running binary's location.
	installDir, err := executableDir()
	if err != nil {
		if updateJSON {
			return outputJSON(updateOutput{
				Current:   info.CurrentVersion,
				Latest:    info.LatestVersion,
				Available: true,
				Error:     err.Error(),
			})
		}
		return fmt.Errorf("locate install directory: %w", err)
	}

	if !updateJSON {
		fmt.Printf("  Downloading %s%s%s...\n", colorCyan, info.LatestVersion, colorReset)
	}

	stagingDir, err := u.Download(ctx, info, installDir)
	if err != nil {
		if updateJSON {
			return outputJSON(updateOutput{
				Current:   info.CurrentVersion,
				Latest:    info.LatestVersion,
				Available: true,
				Error:     err.Error(),
			})
		}
		return fmt.Errorf("download update: %w", err)
	}

	if !updateJSON {
		fmt.Printf("  Installing...\n")
	}

	if err := selfupdate.Apply(stagingDir, installDir); err != nil {
		if updateJSON {
			return outputJSON(updateOutput{
				Current:   info.CurrentVersion,
				Latest:    info.LatestVersion,
				Available: true,
				Error:     err.Error(),
			})
		}
		return fmt.Errorf("apply update: %w", err)
	}

	if updateJSON {
		return outputJSON(updateOutput{
			Current:   info.CurrentVersion,
			Latest:    info.LatestVersion,
			Available: true,
			Applied:   true,
		})
	}

	fmt.Printf("\n  %sUpdated successfully to %s%s\n", colorGreen, info.LatestVersion, colorReset)
	fmt.Printf("  Restart qurl-frpc to use the new version.\n\n")
	return nil
}

func outputJSON(out updateOutput) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(out)
}

// executableDir returns the directory containing the running binary,
// resolving symlinks.
func executableDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(exe)
	if err != nil {
		return "", err
	}
	return filepath.Dir(resolved), nil
}
