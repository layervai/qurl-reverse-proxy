package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDiscover_ExplicitPath(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "custom.yaml")
	if err := os.WriteFile(p, []byte("server:\n  addr: x\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	got, isLegacy, err := Discover(p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != p {
		t.Errorf("path = %q, want %q", got, p)
	}
	if isLegacy {
		t.Error("isLegacy should be false")
	}
}

func TestDiscover_ExplicitPathMissing(t *testing.T) {
	_, _, err := Discover("/nonexistent/file.yaml")
	if err == nil {
		t.Fatal("expected error for missing explicit path")
	}
}

func TestDiscover_CWD(t *testing.T) {
	dir := t.TempDir()
	// Resolve symlinks so the comparison works on macOS where /var -> /private/var.
	dir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dir, yamlConfigName)
	if err := os.WriteFile(p, []byte("server:\n  addr: x\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Temporarily change CWD.
	orig, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chdir(orig) })

	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}

	got, isLegacy, err := Discover("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != p {
		t.Errorf("path = %q, want %q", got, p)
	}
	if isLegacy {
		t.Error("isLegacy should be false")
	}
}

func TestDiscover_UserConfigDir(t *testing.T) {
	// Use a temp dir as a fake home.
	home := t.TempDir()
	t.Setenv("HOME", home)

	configDir := filepath.Join(home, userConfigDir)
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(configDir, yamlConfigName)
	if err := os.WriteFile(p, []byte("server:\n  addr: x\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Make sure CWD does not contain the config.
	emptyDir := t.TempDir()
	orig, _ := os.Getwd()
	t.Cleanup(func() { os.Chdir(orig) })
	os.Chdir(emptyDir)

	got, isLegacy, err := Discover("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != p {
		t.Errorf("path = %q, want %q", got, p)
	}
	if isLegacy {
		t.Error("isLegacy should be false")
	}
}

func TestDiscover_NothingFound(t *testing.T) {
	// Point CWD and HOME to empty dirs so nothing is found.
	emptyDir := t.TempDir()
	emptyHome := t.TempDir()
	t.Setenv("HOME", emptyHome)

	orig, _ := os.Getwd()
	t.Cleanup(func() { os.Chdir(orig) })
	os.Chdir(emptyDir)

	_, _, err := Discover("")
	if err == nil {
		t.Fatal("expected error when no config is found")
	}
}
