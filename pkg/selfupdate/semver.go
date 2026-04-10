package selfupdate

import (
	"fmt"
	"strconv"
	"strings"
)

// Version represents a parsed semantic version (major.minor.patch).
type Version struct {
	Major int
	Minor int
	Patch int
	Raw   string // original input, preserved for display
}

// Parse parses a version string like "v1.2.3", "1.2.3", or "dev".
// Returns an error for malformed input. The special value "dev" returns
// a zero Version with Raw set to "dev".
func Parse(s string) (Version, error) {
	if s == "" {
		return Version{}, fmt.Errorf("empty version string")
	}

	raw := s

	// "dev" is a sentinel value for development builds.
	if s == "dev" {
		return Version{Raw: "dev"}, nil
	}

	s = strings.TrimPrefix(s, "v")

	// Strip pre-release suffix (e.g., "-rc1", "-beta.2") for parsing.
	// We only compare major.minor.patch.
	if idx := strings.IndexByte(s, '-'); idx != -1 {
		s = s[:idx]
	}

	parts := strings.SplitN(s, ".", 3)
	if len(parts) != 3 {
		return Version{}, fmt.Errorf("invalid version %q: expected major.minor.patch", raw)
	}

	major, err := strconv.Atoi(parts[0])
	if err != nil {
		return Version{}, fmt.Errorf("invalid major version in %q: %w", raw, err)
	}
	minor, err := strconv.Atoi(parts[1])
	if err != nil {
		return Version{}, fmt.Errorf("invalid minor version in %q: %w", raw, err)
	}
	patch, err := strconv.Atoi(parts[2])
	if err != nil {
		return Version{}, fmt.Errorf("invalid patch version in %q: %w", raw, err)
	}

	return Version{Major: major, Minor: minor, Patch: patch, Raw: raw}, nil
}

// IsDev reports whether this is a development build (unparseable version).
func (v Version) IsDev() bool {
	return v.Raw == "dev"
}

// Compare returns -1 if v < other, 0 if equal, +1 if v > other.
// Dev versions are always "less than" any release version.
// Two dev versions are equal.
func (v Version) Compare(other Version) int {
	if v.IsDev() && other.IsDev() {
		return 0
	}
	if v.IsDev() {
		return -1
	}
	if other.IsDev() {
		return 1
	}

	if v.Major != other.Major {
		return cmpInt(v.Major, other.Major)
	}
	if v.Minor != other.Minor {
		return cmpInt(v.Minor, other.Minor)
	}
	return cmpInt(v.Patch, other.Patch)
}

// NewerThan reports whether v is strictly newer than other.
func (v Version) NewerThan(other Version) bool {
	return v.Compare(other) > 0
}

// String returns the version in "vMAJOR.MINOR.PATCH" format.
// Dev versions return "dev".
func (v Version) String() string {
	if v.IsDev() {
		return "dev"
	}
	return fmt.Sprintf("v%d.%d.%d", v.Major, v.Minor, v.Patch)
}

func cmpInt(a, b int) int {
	if a < b {
		return -1
	}
	if a > b {
		return 1
	}
	return 0
}
