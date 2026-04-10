package version

import (
	"strings"
	"testing"
)

func TestFull(t *testing.T) {
	out := Full()
	if !strings.Contains(out, "qurl-proxy") {
		t.Errorf("Full() missing 'qurl-proxy': %s", out)
	}
}

func TestShort(t *testing.T) {
	out := Short()
	if !strings.Contains(out, "qurl-proxy") {
		t.Errorf("Short() missing 'qurl-proxy': %s", out)
	}
}
