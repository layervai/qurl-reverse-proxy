package main

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/layervai/qurl-reverse-proxy/pkg/version"
)

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version information",
	Run: func(cmd *cobra.Command, args []string) {
		if short, _ := cmd.Flags().GetBool("short"); short {
			fmt.Println(version.Short())
		} else {
			fmt.Println(version.Full())
		}
	},
}

func init() {
	versionCmd.Flags().Bool("short", false, "print only the short version string")
}
