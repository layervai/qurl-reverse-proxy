package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/layervai/qurl-reverse-proxy/pkg/apiclient"
	nhpconfig "github.com/layervai/qurl-reverse-proxy/pkg/config"
)

var removeID string

func init() {
	removeCmd.Flags().StringVar(&removeID, "id", "", "resource ID to remove (alternative to name)")
	rootCmd.AddCommand(removeCmd)
}

var removeCmd = &cobra.Command{
	Use:   "remove [name]",
	Short: "Remove a service route",
	Long: `Remove a service route from the configuration by name or resource ID.

Examples:
  qurl-frpc remove "My App"
  qurl-frpc remove --id res_abc123`,
	Args: cobra.MaximumNArgs(1),
	RunE: runRemove,
}

func runRemove(_ *cobra.Command, args []string) error {
	name := ""
	if len(args) > 0 {
		name = args[0]
	}

	if name == "" && removeID == "" {
		return fmt.Errorf("provide a route name as argument or use --id flag")
	}

	// Load config
	cfgPath, _, discoverErr := nhpconfig.Discover(cfgFile)
	if discoverErr != nil {
		return fmt.Errorf("no config file found; use --config to specify the path")
	}

	cfg, err := nhpconfig.Load(cfgPath)
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	// Find the route
	idx := -1
	for i, r := range cfg.Routes {
		if removeID != "" && r.ResourceID == removeID {
			idx = i
			break
		}
		if name != "" && strings.EqualFold(r.Name, name) {
			idx = i
			break
		}
	}

	if idx == -1 {
		if removeID != "" {
			return fmt.Errorf("no route found with resource ID %q", removeID)
		}
		return fmt.Errorf("no route found with name %q", name)
	}

	removed := cfg.Routes[idx]

	// Delete from QURL API if token and resource_id are available
	if tok := getToken(); tok != "" && removed.ResourceID != "" {
		client := apiclient.New(getAPIBaseURL(), tok)
		if apiErr := client.DeleteResource(context.Background(), removed.ResourceID); apiErr != nil {
			fmt.Printf("Warning: failed to delete from QURL API: %v\n", apiErr)
		} else {
			fmt.Printf("Deleted from QURL API (resource_id: %s)\n", removed.ResourceID)
		}
	}

	// Remove from slice
	cfg.Routes = append(cfg.Routes[:idx], cfg.Routes[idx+1:]...)

	// Save config
	if err := nhpconfig.Save(cfg, cfgPath); err != nil {
		return fmt.Errorf("saving config: %w", err)
	}

	fmt.Printf("Removed route %q (%s)\n", removed.Name, removed.Type)
	fmt.Printf("Config saved to %s\n", cfgPath)

	return nil
}
