package main

import (
	"fmt"

	"github.com/spf13/cobra"
)

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show proxy tunnel status",
	RunE: func(cmd *cobra.Command, args []string) error {
		fmt.Println("The 'status' command is not yet implemented. Coming soon.")
		return nil
	},
}

func init() {
	statusCmd.Flags().Bool("json", false, "output status in JSON format")
}
