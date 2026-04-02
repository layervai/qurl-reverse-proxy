package banner

import (
	"fmt"

	"github.com/OpenNHP/nhp-frp/pkg/version"
)

const (
	ColorReset  = "\033[0m"
	ColorGreen  = "\033[32m"
	ColorYellow = "\033[33m"
	ColorCyan   = "\033[36m"
	ColorBold   = "\033[1m"
)

const art = `
  _   _ _   _ ____        _____ ____  ____
 | \ | | | | |  _ \      |  ___|  _ \|  _ \
 |  \| | |_| | |_) |_____| |_  | |_) | |_) |
 | |\  |  _  |  __/______|  _| |  _ <|  __/
 |_| \_|_| |_|_|         |_|   |_| \_\_|
`

// Print displays the NHP-FRP banner with the given role (e.g. "client" or "server").
func Print(role string) {
	fmt.Printf("%s%s%s%s", ColorBold, ColorCyan, art, ColorReset)
	fmt.Printf("  %s%s (%s)%s\n\n", ColorGreen, version.Short(), role, ColorReset)
}
