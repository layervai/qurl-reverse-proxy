package main

import (
	"encoding/json"
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/spf13/cobra"

	nhpconfig "github.com/layervai/qurl-reverse-proxy/pkg/config"
)

var listJSON bool

func init() {
	listCmd.Flags().BoolVar(&listJSON, "json", false, "output in JSON format")
	rootCmd.AddCommand(listCmd)
}

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List all service routes",
	Long: `List all service routes in the configuration.

Examples:
  qurl-frpc list
  qurl-frpc list --json`,
	RunE: runList,
}

func runList(_ *cobra.Command, _ []string) error {
	// Load config (YAML only, not legacy TOML)
	cfgPath, isLegacy, discoverErr := nhpconfig.Discover(cfgFile)
	if discoverErr != nil || isLegacy {
		fmt.Println("No routes configured. Use 'qurl-frpc add' to register a service.")
		return nil
	}

	cfg, err := nhpconfig.Load(cfgPath)
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	if len(cfg.Routes) == 0 {
		fmt.Println("No routes configured.")
		return nil
	}

	if listJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(cfg.Routes)
	}

	// Table output
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "NAME\tTYPE\tTARGET\tRESOURCE ID")
	for _, r := range cfg.Routes {
		target := fmt.Sprintf("%s:%d", r.LocalIP, r.LocalPort)
		resID := r.ResourceID
		if resID == "" {
			resID = "-"
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", r.Name, r.Type, target, resID)
	}
	return w.Flush()
}
