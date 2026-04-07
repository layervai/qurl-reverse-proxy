package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveAndLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test-config.yaml")

	original := &Config{
		Server: ServerConfig{
			Addr: "proxy.example.com",
			Port: 7000,
		},
		NHP: NHPConfig{
			MachineID: "abc12345",
		},
		Routes: []Route{
			{
				Name:       "my-app",
				Type:       RouteTypeHTTP,
				LocalIP:    "127.0.0.1",
				LocalPort:  8080,
				Subdomain:  "abc12345-my-app",
				ResourceID: "res_123",
				TargetURL:  "http://localhost:8080",
			},
			{
				Name:       "my-db",
				Type:       RouteTypeTCP,
				LocalIP:    "127.0.0.1",
				LocalPort:  5432,
				RemotePort: 15432,
				TargetURL:  "tcp://localhost:5432",
			},
		},
	}

	if err := Save(original, path); err != nil {
		t.Fatalf("Save() error: %v", err)
	}

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("saved file does not exist: %v", err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if loaded.NHP.MachineID != original.NHP.MachineID {
		t.Errorf("NHP.MachineID: got %q, want %q", loaded.NHP.MachineID, original.NHP.MachineID)
	}
	if len(loaded.Routes) != len(original.Routes) {
		t.Fatalf("Routes length: got %d, want %d", len(loaded.Routes), len(original.Routes))
	}

	for i, want := range original.Routes {
		got := loaded.Routes[i]
		if got.Name != want.Name {
			t.Errorf("route %d Name: got %q, want %q", i, got.Name, want.Name)
		}
		if got.Type != want.Type {
			t.Errorf("route %d Type: got %q, want %q", i, got.Type, want.Type)
		}
		if got.LocalPort != want.LocalPort {
			t.Errorf("route %d LocalPort: got %d, want %d", i, got.LocalPort, want.LocalPort)
		}
	}
}

func TestSaveCreatesParentDirs(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "deep", "config.yaml")

	cfg := &Config{
		Server: ServerConfig{Addr: "test.example.com", Port: 7000},
	}
	if err := Save(cfg, path); err != nil {
		t.Fatalf("Save() error: %v", err)
	}

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("file not created at nested path: %v", err)
	}
}

func TestSaveNilConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")

	if err := Save(nil, path); err == nil {
		t.Fatal("Save(nil) should return error")
	}
}
