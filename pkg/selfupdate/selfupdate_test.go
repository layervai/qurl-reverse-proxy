package selfupdate

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// testRelease creates a mock GitHub release JSON payload.
func testRelease(tag string, assets ...asset) releaseResponse {
	return releaseResponse{
		TagName: tag,
		HTMLURL: "https://github.com/" + GitHubRepo + "/releases/tag/" + tag,
		Assets:  assets,
	}
}

// testTarball creates an in-memory gzip-compressed tar archive containing
// the given files. Each file entry is name -> content.
func testTarball(t *testing.T, files map[string][]byte) []byte {
	t.Helper()

	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)

	for name, content := range files {
		hdr := &tar.Header{
			Name: name,
			Size: int64(len(content)),
			Mode: 0o755,
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatalf("write tar header for %s: %v", name, err)
		}
		if _, err := tw.Write(content); err != nil {
			t.Fatalf("write tar content for %s: %v", name, err)
		}
	}

	if err := tw.Close(); err != nil {
		t.Fatalf("close tar writer: %v", err)
	}
	if err := gw.Close(); err != nil {
		t.Fatalf("close gzip writer: %v", err)
	}

	return buf.Bytes()
}

// serveJSON is a test helper that writes JSON to an http.ResponseWriter.
func serveJSON(t *testing.T, w http.ResponseWriter, v any) {
	t.Helper()
	if err := json.NewEncoder(w).Encode(v); err != nil {
		t.Errorf("encode JSON: %v", err)
	}
}

// serveBytes is a test helper that writes raw bytes to an http.ResponseWriter.
func serveBytes(t *testing.T, w http.ResponseWriter, data []byte) {
	t.Helper()
	if _, err := w.Write(data); err != nil {
		t.Errorf("write response: %v", err)
	}
}

// sha256hex returns the hex-encoded SHA256 hash of data.
func sha256hex(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// testSHA256SUMS builds a SHA256SUMS file body for the given asset name and data.
func testSHA256SUMS(assetName string, data []byte) []byte {
	return []byte(fmt.Sprintf("%s  %s\n", sha256hex(data), assetName))
}

func TestCheckForUpdate_Available(t *testing.T) {
	wantAsset := assetName("v1.1.0")
	release := testRelease("v1.1.0", asset{
		Name:               wantAsset,
		BrowserDownloadURL: "https://example.com/download/" + wantAsset,
	})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		serveJSON(t, w, release)
	}))
	defer srv.Close()

	u := &Updater{APIEndpoint: srv.URL}
	info, err := u.CheckForUpdate(context.Background(), "v1.0.0")
	if err != nil {
		t.Fatalf("CheckForUpdate: %v", err)
	}

	if !info.Available {
		t.Error("expected update to be available")
	}
	if info.LatestVersion != "v1.1.0" {
		t.Errorf("LatestVersion = %q, want v1.1.0", info.LatestVersion)
	}
	if info.CurrentVersion != "v1.0.0" {
		t.Errorf("CurrentVersion = %q, want v1.0.0", info.CurrentVersion)
	}
	if info.AssetURL == "" {
		t.Error("expected AssetURL to be set")
	}
	if info.ReleaseURL == "" {
		t.Error("expected ReleaseURL to be set")
	}
}

func TestCheckForUpdate_UpToDate(t *testing.T) {
	release := testRelease("v1.0.0")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		serveJSON(t, w, release)
	}))
	defer srv.Close()

	u := &Updater{APIEndpoint: srv.URL}
	info, err := u.CheckForUpdate(context.Background(), "v1.0.0")
	if err != nil {
		t.Fatalf("CheckForUpdate: %v", err)
	}

	if info.Available {
		t.Error("expected no update available")
	}
}

func TestCheckForUpdate_OlderRelease(t *testing.T) {
	release := testRelease("v0.9.0")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		serveJSON(t, w, release)
	}))
	defer srv.Close()

	u := &Updater{APIEndpoint: srv.URL}
	info, err := u.CheckForUpdate(context.Background(), "v1.0.0")
	if err != nil {
		t.Fatalf("CheckForUpdate: %v", err)
	}

	if info.Available {
		t.Error("expected no update when remote is older")
	}
}

func TestCheckForUpdate_DevBuild(t *testing.T) {
	// Dev builds should never trigger updates, no API call should be made.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("API should not be called for dev builds")
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	u := &Updater{APIEndpoint: srv.URL}
	info, err := u.CheckForUpdate(context.Background(), "dev")
	if err != nil {
		t.Fatalf("CheckForUpdate: %v", err)
	}

	if info.Available {
		t.Error("dev builds should never report updates available")
	}
}

func TestCheckForUpdate_NetworkError(t *testing.T) {
	// Closed server simulates network failure.
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {}))
	srv.Close()

	u := &Updater{APIEndpoint: srv.URL}
	_, err := u.CheckForUpdate(context.Background(), "v1.0.0")
	if err == nil {
		t.Error("expected error for network failure")
	}
}

func TestCheckForUpdate_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden) // rate limited
	}))
	defer srv.Close()

	u := &Updater{APIEndpoint: srv.URL}
	_, err := u.CheckForUpdate(context.Background(), "v1.0.0")
	if err == nil {
		t.Error("expected error for 403 response")
	}
}

func TestCheckForUpdate_AssetMatching(t *testing.T) {
	// Create assets for multiple platforms.
	wantAsset := assetName("v1.1.0")
	release := testRelease("v1.1.0",
		asset{Name: "qurl-reverse-proxy-v1.1.0-linux-amd64.tar.gz", BrowserDownloadURL: "https://example.com/linux"},
		asset{Name: "qurl-reverse-proxy-v1.1.0-darwin-arm64.tar.gz", BrowserDownloadURL: "https://example.com/darwin"},
		asset{Name: "qurl-reverse-proxy-v1.1.0-windows-amd64.tar.gz", BrowserDownloadURL: "https://example.com/windows"},
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		serveJSON(t, w, release)
	}))
	defer srv.Close()

	u := &Updater{APIEndpoint: srv.URL}
	info, err := u.CheckForUpdate(context.Background(), "v1.0.0")
	if err != nil {
		t.Fatalf("CheckForUpdate: %v", err)
	}

	// Should match the asset for the current platform.
	if info.AssetURL == "" {
		t.Fatalf("expected AssetURL to be set for asset %s", wantAsset)
	}

	expectedURL := fmt.Sprintf("https://example.com/%s", runtime.GOOS)
	if info.AssetURL != expectedURL {
		t.Errorf("AssetURL = %q, want %q", info.AssetURL, expectedURL)
	}
}

func TestCheckForUpdate_NoMatchingAsset(t *testing.T) {
	release := testRelease("v1.1.0",
		asset{Name: "qurl-reverse-proxy-v1.1.0-freebsd-amd64.tar.gz", BrowserDownloadURL: "https://example.com/freebsd"},
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		serveJSON(t, w, release)
	}))
	defer srv.Close()

	u := &Updater{APIEndpoint: srv.URL}
	info, err := u.CheckForUpdate(context.Background(), "v1.0.0")
	if err != nil {
		t.Fatalf("CheckForUpdate: %v", err)
	}

	if info.AssetURL != "" {
		t.Errorf("expected empty AssetURL when no matching asset, got %q", info.AssetURL)
	}
	// Update is still "available" even if no asset matches — the caller
	// should check AssetURL before trying to download.
	if !info.Available {
		t.Error("update should still be marked available")
	}
}

func TestCheckForUpdate_ContextCanceled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		// slow response
		select {}
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	u := &Updater{APIEndpoint: srv.URL}
	_, err := u.CheckForUpdate(ctx, "v1.0.0")
	if err == nil {
		t.Error("expected error for canceled context")
	}
}

func TestDownload(t *testing.T) {
	binaryName := "qurl-frpc"
	if runtime.GOOS == "windows" {
		binaryName = "qurl-frpc.exe"
	}

	tarballData := testTarball(t, map[string][]byte{
		binaryName:          []byte("#!/bin/sh\necho fake-binary"),
		"qurl-frps":        []byte("#!/bin/sh\necho server"),
		"sdk/nhp-agent.so": []byte("fake-sdk"),
		"sdk/nhp-agent.h":  []byte("// header"),
		"etc/config.yaml":  []byte("config: true"),
		"LICENSE":           []byte("MIT"),
	})
	checksumData := testSHA256SUMS(assetName("v1.1.0"), tarballData)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/download":
			w.Header().Set("Content-Type", "application/gzip")
			serveBytes(t, w, tarballData)
		case "/v1.1.0/SHA256SUMS":
			serveBytes(t, w, checksumData)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	destDir := t.TempDir()
	u := &Updater{BinaryName: binaryName, ChecksumBaseURL: srv.URL}
	info := &UpdateInfo{
		CurrentVersion: "v1.0.0",
		LatestVersion:  "v1.1.0",
		Available:      true,
		AssetURL:       srv.URL + "/download",
	}

	stagingDir, err := u.Download(context.Background(), info, destDir)
	if err != nil {
		t.Fatalf("Download: %v", err)
	}

	// Verify binary was extracted.
	binaryPath := filepath.Join(stagingDir, binaryName)
	data, err := os.ReadFile(binaryPath)
	if err != nil {
		t.Fatalf("read binary: %v", err)
	}
	if string(data) != "#!/bin/sh\necho fake-binary" {
		t.Errorf("binary content = %q, want fake-binary script", data)
	}

	// Verify SDK was extracted.
	sdkPath := filepath.Join(stagingDir, "sdk", "nhp-agent.so")
	if _, err := os.Stat(sdkPath); os.IsNotExist(err) {
		t.Error("expected sdk/nhp-agent.so to be extracted")
	}

	// Verify non-essential files were NOT extracted (etc/, LICENSE).
	for _, skip := range []string{"etc/config.yaml", "LICENSE", "qurl-frps"} {
		if _, err := os.Stat(filepath.Join(stagingDir, skip)); !os.IsNotExist(err) {
			t.Errorf("expected %s to NOT be extracted, but it exists", skip)
		}
	}

	// Verify binary is executable.
	info2, err := os.Stat(binaryPath)
	if err != nil {
		t.Fatalf("stat binary: %v", err)
	}
	if info2.Mode()&0o111 == 0 {
		t.Error("binary should be executable")
	}
}

func TestDownload_NoAssetURL(t *testing.T) {
	u := &Updater{}
	info := &UpdateInfo{Available: true, AssetURL: ""}

	_, err := u.Download(context.Background(), info, t.TempDir())
	if err == nil {
		t.Error("expected error when AssetURL is empty")
	}
}

func TestDownload_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	u := &Updater{}
	info := &UpdateInfo{Available: true, AssetURL: srv.URL + "/missing"}

	_, err := u.Download(context.Background(), info, t.TempDir())
	if err == nil {
		t.Error("expected error for 404 response")
	}
}

func TestDownload_MissingBinary(t *testing.T) {
	// Tarball without the expected binary.
	tarballData := testTarball(t, map[string][]byte{
		"some-other-file": []byte("not the binary"),
	})
	checksumData := testSHA256SUMS(assetName("v1.1.0"), tarballData)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/download":
			serveBytes(t, w, tarballData)
		case "/v1.1.0/SHA256SUMS":
			serveBytes(t, w, checksumData)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	u := &Updater{BinaryName: "qurl-frpc", ChecksumBaseURL: srv.URL}
	info := &UpdateInfo{Available: true, LatestVersion: "v1.1.0", AssetURL: srv.URL + "/download"}

	_, err := u.Download(context.Background(), info, t.TempDir())
	if err == nil {
		t.Error("expected error when binary is missing from tarball")
	}
}

func TestDownload_ChecksumMismatch(t *testing.T) {
	tarballData := testTarball(t, map[string][]byte{
		"qurl-frpc": []byte("binary"),
	})
	// Serve a SHA256SUMS with a wrong hash.
	badChecksum := []byte(fmt.Sprintf("%s  %s\n", "0000000000000000000000000000000000000000000000000000000000000000", assetName("v1.1.0")))

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/download":
			serveBytes(t, w, tarballData)
		case "/v1.1.0/SHA256SUMS":
			serveBytes(t, w, badChecksum)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	u := &Updater{BinaryName: "qurl-frpc", ChecksumBaseURL: srv.URL}
	info := &UpdateInfo{Available: true, LatestVersion: "v1.1.0", AssetURL: srv.URL + "/download"}

	_, err := u.Download(context.Background(), info, t.TempDir())
	if err == nil {
		t.Fatal("expected error for checksum mismatch")
	}
	if !strings.Contains(err.Error(), "checksum mismatch") {
		t.Errorf("error should mention checksum mismatch, got: %v", err)
	}
}

func TestDownload_ChecksumUnavailable(t *testing.T) {
	tarballData := testTarball(t, map[string][]byte{
		"qurl-frpc": []byte("binary"),
	})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/download":
			serveBytes(t, w, tarballData)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	u := &Updater{BinaryName: "qurl-frpc", ChecksumBaseURL: srv.URL}
	info := &UpdateInfo{Available: true, LatestVersion: "v1.1.0", AssetURL: srv.URL + "/download"}

	_, err := u.Download(context.Background(), info, t.TempDir())
	if err == nil {
		t.Fatal("expected error when SHA256SUMS is not available")
	}
	if !strings.Contains(err.Error(), "SHA256SUMS") {
		t.Errorf("error should mention SHA256SUMS, got: %v", err)
	}
}

func TestApply(t *testing.T) {
	installDir := t.TempDir()
	stagingDir := filepath.Join(installDir, stagingDirName)
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		t.Fatal(err)
	}

	// Create existing binary in install dir.
	oldBinary := filepath.Join(installDir, "qurl-frpc")
	if err := os.WriteFile(oldBinary, []byte("old-binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	// Create staged binary.
	newBinary := filepath.Join(stagingDir, "qurl-frpc")
	if err := os.WriteFile(newBinary, []byte("new-binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	// Create staged SDK.
	sdkDir := filepath.Join(stagingDir, "sdk")
	if err := os.MkdirAll(sdkDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sdkDir, "nhp-agent.so"), []byte("new-sdk"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := Apply(stagingDir, installDir); err != nil {
		t.Fatalf("Apply: %v", err)
	}

	// Verify new binary is in place.
	data, err := os.ReadFile(oldBinary)
	if err != nil {
		t.Fatalf("read installed binary: %v", err)
	}
	if string(data) != "new-binary" {
		t.Errorf("binary content = %q, want new-binary", data)
	}

	// Verify SDK was installed.
	sdkData, err := os.ReadFile(filepath.Join(installDir, "sdk", "nhp-agent.so"))
	if err != nil {
		t.Fatalf("read installed SDK: %v", err)
	}
	if string(sdkData) != "new-sdk" {
		t.Errorf("sdk content = %q, want new-sdk", sdkData)
	}

	// Verify backup was cleaned up.
	if _, err := os.Stat(oldBinary + backupSuffix); !os.IsNotExist(err) {
		t.Error("backup file should be removed after successful apply")
	}

	// Verify staging dir was cleaned up.
	if _, err := os.Stat(stagingDir); !os.IsNotExist(err) {
		t.Error("staging dir should be removed after successful apply")
	}
}

func TestApply_Rollback(t *testing.T) {
	installDir := t.TempDir()
	stagingDir := filepath.Join(installDir, stagingDirName)
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		t.Fatal(err)
	}

	// Create existing binary.
	oldBinary := filepath.Join(installDir, "qurl-frpc")
	if err := os.WriteFile(oldBinary, []byte("original-binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	// Create staged binary (this will succeed).
	if err := os.WriteFile(filepath.Join(stagingDir, "qurl-frpc"), []byte("new-binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	// Create a staged sdk/ dir with a file that targets a read-only directory.
	sdkStaging := filepath.Join(stagingDir, "sdk")
	if err := os.MkdirAll(sdkStaging, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sdkStaging, "nhp-agent.so"), []byte("new-sdk"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Create existing sdk dir but make it read-only to force a failure.
	installSDK := filepath.Join(installDir, "sdk")
	if err := os.MkdirAll(installSDK, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installSDK, "nhp-agent.so"), []byte("old-sdk"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Make the sdk directory read-only so the rename for backup fails.
	if err := os.Chmod(installSDK, 0o444); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(installSDK, 0o755) })

	err := Apply(stagingDir, installDir)
	if err == nil {
		t.Fatal("expected Apply to fail due to read-only sdk dir")
	}

	// Verify original binary was restored (rollback).
	data, err := os.ReadFile(oldBinary)
	if err != nil {
		t.Fatalf("read binary after rollback: %v", err)
	}
	if string(data) != "original-binary" {
		t.Errorf("binary after rollback = %q, want original-binary", data)
	}
}

func TestApply_FreshInstall(t *testing.T) {
	// Apply when no existing binary exists (fresh install scenario).
	installDir := t.TempDir()
	stagingDir := filepath.Join(installDir, stagingDirName)
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(stagingDir, "qurl-frpc"), []byte("brand-new"), 0o755); err != nil {
		t.Fatal(err)
	}

	if err := Apply(stagingDir, installDir); err != nil {
		t.Fatalf("Apply: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(installDir, "qurl-frpc"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "brand-new" {
		t.Errorf("content = %q, want brand-new", data)
	}
}

func TestCleanStaging(t *testing.T) {
	dir := t.TempDir()
	stagingDir := filepath.Join(dir, stagingDirName)
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stagingDir, "file"), []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := CleanStaging(dir); err != nil {
		t.Fatalf("CleanStaging: %v", err)
	}

	if _, err := os.Stat(stagingDir); !os.IsNotExist(err) {
		t.Error("staging dir should be removed")
	}
}

func TestCleanStaging_NoDir(t *testing.T) {
	// Should not error if staging dir doesn't exist.
	if err := CleanStaging(t.TempDir()); err != nil {
		t.Fatalf("CleanStaging on empty dir: %v", err)
	}
}

func TestHasStagedUpdate(t *testing.T) {
	dir := t.TempDir()

	// No staging dir.
	if _, ok := HasStagedUpdate(dir, "qurl-frpc"); ok {
		t.Error("expected no staged update")
	}

	// Create staging with binary.
	stagingDir := filepath.Join(dir, stagingDirName)
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stagingDir, "qurl-frpc"), []byte("staged"), 0o755); err != nil {
		t.Fatal(err)
	}

	p, ok := HasStagedUpdate(dir, "qurl-frpc")
	if !ok {
		t.Error("expected staged update to be found")
	}
	if p != stagingDir {
		t.Errorf("staging path = %q, want %q", p, stagingDir)
	}
}

func TestExtractTarGz_DirectoryTraversal(t *testing.T) {
	// Tarball with a path traversal attempt — should be skipped.
	// The extractTarGz function filters by binary name and sdk/ prefix,
	// so the traversal path is ignored because it doesn't match either filter.
	tarballData := testTarball(t, map[string][]byte{
		"../../../etc/passwd": []byte("evil"),
		"qurl-frpc":          []byte("safe-binary"),
	})

	destDir := t.TempDir()
	r := bytes.NewReader(tarballData)

	if err := extractTarGz(r, destDir, "qurl-frpc"); err != nil {
		t.Fatalf("extractTarGz: %v", err)
	}

	// Binary should exist.
	if _, err := os.Stat(filepath.Join(destDir, "qurl-frpc")); os.IsNotExist(err) {
		t.Error("binary should be extracted")
	}

	// The traversal path should never appear inside destDir.
	// (It's filtered out by the binary/sdk allowlist before the path check matters.)
	traversalTarget := filepath.Join(destDir, "etc", "passwd")
	if _, err := os.Stat(traversalTarget); !os.IsNotExist(err) {
		t.Error("traversal file should not be extracted inside destDir")
	}
}

func TestDownload_ContextCanceled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		// Simulate a slow download.
		select {}
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	u := &Updater{}
	info := &UpdateInfo{Available: true, AssetURL: srv.URL + "/download"}

	_, err := u.Download(ctx, info, t.TempDir())
	if err == nil {
		t.Error("expected error for canceled context")
	}
}

func TestEndToEnd_CheckDownloadApply(t *testing.T) {
	binaryName := "qurl-frpc"
	if runtime.GOOS == "windows" {
		binaryName = "qurl-frpc.exe"
	}

	// Create a test tarball.
	tarballData := testTarball(t, map[string][]byte{
		binaryName:         []byte("updated-binary-v1.1.0"),
		"sdk/nhp-agent.so": []byte("updated-sdk-v1.1.0"),
	})
	checksumData := testSHA256SUMS(assetName("v1.1.0"), tarballData)

	// Serve the API, tarball, and SHA256SUMS.
	assetPath := "/download/release.tar.gz"
	release := testRelease("v1.1.0", asset{
		Name:               assetName("v1.1.0"),
		BrowserDownloadURL: "", // will be set below
	})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api":
			serveJSON(t, w, release)
		case assetPath:
			serveBytes(t, w, tarballData)
		case "/v1.1.0/SHA256SUMS":
			serveBytes(t, w, checksumData)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	// Set the asset URL now that we have the server URL.
	release.Assets[0].BrowserDownloadURL = srv.URL + assetPath

	// Re-register handler with updated release.
	srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api":
			serveJSON(t, w, release)
		case assetPath:
			serveBytes(t, w, tarballData)
		case "/v1.1.0/SHA256SUMS":
			serveBytes(t, w, checksumData)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})

	// Setup install directory with an existing binary.
	installDir := t.TempDir()
	existingBinary := filepath.Join(installDir, binaryName)
	if err := os.WriteFile(existingBinary, []byte("old-binary-v1.0.0"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(installDir, "sdk"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installDir, "sdk", "nhp-agent.so"), []byte("old-sdk"), 0o644); err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	u := &Updater{
		APIEndpoint:     srv.URL + "/api",
		ChecksumBaseURL: srv.URL,
		BinaryName:      binaryName,
	}

	// Step 1: Check for update.
	info, err := u.CheckForUpdate(ctx, "v1.0.0")
	if err != nil {
		t.Fatalf("CheckForUpdate: %v", err)
	}
	if !info.Available {
		t.Fatal("expected update to be available")
	}

	// Step 2: Download to staging.
	stagingDir, err := u.Download(ctx, info, installDir)
	if err != nil {
		t.Fatalf("Download: %v", err)
	}

	// Verify staging exists but install dir still has old binary.
	oldData, _ := os.ReadFile(existingBinary)
	if string(oldData) != "old-binary-v1.0.0" {
		t.Error("existing binary should not be modified during download")
	}

	// Step 3: Apply staged update.
	if err := Apply(stagingDir, installDir); err != nil {
		t.Fatalf("Apply: %v", err)
	}

	// Verify new binary.
	newData, err := os.ReadFile(existingBinary)
	if err != nil {
		t.Fatal(err)
	}
	if string(newData) != "updated-binary-v1.1.0" {
		t.Errorf("binary = %q, want updated-binary-v1.1.0", newData)
	}

	// Verify new SDK.
	sdkData, err := os.ReadFile(filepath.Join(installDir, "sdk", "nhp-agent.so"))
	if err != nil {
		t.Fatal(err)
	}
	if string(sdkData) != "updated-sdk-v1.1.0" {
		t.Errorf("sdk = %q, want updated-sdk-v1.1.0", sdkData)
	}

	// Verify cleanup.
	if _, err := os.Stat(filepath.Join(installDir, stagingDirName)); !os.IsNotExist(err) {
		t.Error("staging dir should be cleaned up after apply")
	}
}
