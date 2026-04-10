package selfupdate

import (
	"testing"
)

func TestParse(t *testing.T) {
	tests := []struct {
		input   string
		want    Version
		wantErr bool
	}{
		{input: "v1.2.3", want: Version{Major: 1, Minor: 2, Patch: 3, Raw: "v1.2.3"}},
		{input: "1.2.3", want: Version{Major: 1, Minor: 2, Patch: 3, Raw: "1.2.3"}},
		{input: "v0.1.0", want: Version{Major: 0, Minor: 1, Patch: 0, Raw: "v0.1.0"}},
		{input: "v10.20.30", want: Version{Major: 10, Minor: 20, Patch: 30, Raw: "v10.20.30"}},
		{input: "v1.2.3-rc1", want: Version{Major: 1, Minor: 2, Patch: 3, Raw: "v1.2.3-rc1"}},
		{input: "v2.0.0-beta.1", want: Version{Major: 2, Minor: 0, Patch: 0, Raw: "v2.0.0-beta.1"}},
		{input: "dev", want: Version{Raw: "dev"}},

		// Error cases
		{input: "", wantErr: true},
		{input: "v1.2", wantErr: true},
		{input: "v1", wantErr: true},
		{input: "abc", wantErr: true},
		{input: "v1.x.3", wantErr: true},
		{input: "v1.2.x", wantErr: true},
		{input: "vx.2.3", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := Parse(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Errorf("Parse(%q) = %+v, want error", tt.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("Parse(%q) error: %v", tt.input, err)
			}
			if got.Major != tt.want.Major || got.Minor != tt.want.Minor || got.Patch != tt.want.Patch || got.Raw != tt.want.Raw {
				t.Errorf("Parse(%q) = %+v, want %+v", tt.input, got, tt.want)
			}
		})
	}
}

func TestVersion_IsDev(t *testing.T) {
	dev, _ := Parse("dev")
	if !dev.IsDev() {
		t.Error("Parse(\"dev\").IsDev() = false, want true")
	}

	rel, _ := Parse("v1.0.0")
	if rel.IsDev() {
		t.Error("Parse(\"v1.0.0\").IsDev() = true, want false")
	}
}

func TestVersion_Compare(t *testing.T) {
	tests := []struct {
		a, b string
		want int
	}{
		// Equal
		{"v1.0.0", "v1.0.0", 0},
		{"1.0.0", "v1.0.0", 0},
		{"v0.1.0", "0.1.0", 0},

		// Major differences
		{"v2.0.0", "v1.0.0", 1},
		{"v1.0.0", "v2.0.0", -1},

		// Minor differences
		{"v1.2.0", "v1.1.0", 1},
		{"v1.1.0", "v1.2.0", -1},

		// Patch differences
		{"v1.0.1", "v1.0.0", 1},
		{"v1.0.0", "v1.0.1", -1},

		// Mixed
		{"v2.0.0", "v1.9.9", 1},
		{"v1.9.9", "v2.0.0", -1},
		{"v1.1.0", "v1.0.9", 1},

		// Dev versions
		{"dev", "dev", 0},
		{"dev", "v0.0.1", -1},
		{"v0.0.1", "dev", 1},
		{"dev", "v999.999.999", -1},

		// Pre-release suffix is stripped for comparison
		{"v1.2.3-rc1", "v1.2.3", 0},
		{"v1.2.3-beta.1", "v1.2.2", 1},
	}

	for _, tt := range tests {
		t.Run(tt.a+"_vs_"+tt.b, func(t *testing.T) {
			a, err := Parse(tt.a)
			if err != nil {
				t.Fatalf("Parse(%q): %v", tt.a, err)
			}
			b, err := Parse(tt.b)
			if err != nil {
				t.Fatalf("Parse(%q): %v", tt.b, err)
			}
			got := a.Compare(b)
			if got != tt.want {
				t.Errorf("%s.Compare(%s) = %d, want %d", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

func TestVersion_NewerThan(t *testing.T) {
	tests := []struct {
		a, b string
		want bool
	}{
		{"v1.1.0", "v1.0.0", true},
		{"v1.0.0", "v1.1.0", false},
		{"v1.0.0", "v1.0.0", false},
		{"dev", "v1.0.0", false},
		{"v1.0.0", "dev", true},
	}

	for _, tt := range tests {
		t.Run(tt.a+"_newer_than_"+tt.b, func(t *testing.T) {
			a, _ := Parse(tt.a)
			b, _ := Parse(tt.b)
			if got := a.NewerThan(b); got != tt.want {
				t.Errorf("%s.NewerThan(%s) = %v, want %v", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

func TestVersion_String(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"v1.2.3", "v1.2.3"},
		{"1.2.3", "v1.2.3"},
		{"v0.1.0", "v0.1.0"},
		{"dev", "dev"},
		{"v1.0.0-rc1", "v1.0.0"}, // pre-release stripped in canonical form
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			v, err := Parse(tt.input)
			if err != nil {
				t.Fatalf("Parse(%q): %v", tt.input, err)
			}
			if got := v.String(); got != tt.want {
				t.Errorf("Parse(%q).String() = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
