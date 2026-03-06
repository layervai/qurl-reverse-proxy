package version

import (
	"fmt"
	"runtime"

	frpversion "github.com/fatedier/frp/pkg/util/version"
)

// These variables are set at build time via -ldflags.
var (
	Version    = "dev"
	GitCommit  = "unknown"
	BuildDate  = "unknown"
	NHPVersion = "unknown"
)

func Full() string {
	return fmt.Sprintf("nhp-frp %s (frp %s, opennhp %s) %s/%s\ngit commit: %s\nbuild date: %s",
		Version, frpversion.Full(), NHPVersion, runtime.GOOS, runtime.GOARCH, GitCommit, BuildDate)
}

func Short() string {
	return fmt.Sprintf("nhp-frp %s (frp %s, opennhp %s)", Version, frpversion.Full(), NHPVersion)
}
