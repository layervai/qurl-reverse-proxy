package selfupdate

import (
	"archive/tar"
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	// GitHubRepo is the GitHub repository for release lookups.
	GitHubRepo = "layervai/qurl-reverse-proxy"

	// githubAPIURL is the endpoint for the latest release.
	githubAPIURL = "https://api.github.com/repos/" + GitHubRepo + "/releases/latest"

	// stagingDirName is the directory name used for staged updates.
	stagingDirName = ".update-staging"

	// backupSuffix is appended to the existing binary during Apply.
	backupSuffix = ".bak"

	// maxDownloadSize limits tarball downloads to 500 MB.
	maxDownloadSize = 500 * 1024 * 1024
)

// releaseResponse is the subset of the GitHub Release API response we need.
type releaseResponse struct {
	TagName     string    `json:"tag_name"`
	HTMLURL     string    `json:"html_url"`
	PublishedAt time.Time `json:"published_at"`
	Assets      []asset   `json:"assets"`
}

type asset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// UpdateInfo describes the result of a version check.
type UpdateInfo struct {
	CurrentVersion string `json:"current"`
	LatestVersion  string `json:"latest"`
	Available      bool   `json:"update_available"`
	ReleaseURL     string `json:"release_url,omitempty"`
	AssetURL       string `json:"asset_url,omitempty"`
}

// Updater performs update checks and applies updates. The zero value uses
// production defaults; fields can be overridden for testing.
type Updater struct {
	// HTTPClient is used for all HTTP requests. Defaults to a client with
	// a 30-second timeout.
	HTTPClient *http.Client

	// APIEndpoint overrides the GitHub API URL (for testing).
	APIEndpoint string

	// ChecksumBaseURL overrides the base URL for SHA256SUMS downloads (for testing).
	// Production default: https://github.com/{GitHubRepo}/releases/download
	ChecksumBaseURL string

	// BinaryName is the name of the binary to extract from tarballs.
	// Defaults to "qurl-frpc".
	BinaryName string
}

func (u *Updater) httpClient() *http.Client {
	if u.HTTPClient != nil {
		return u.HTTPClient
	}
	// Cache the default client so TCP/TLS connections are reused across
	// sequential requests (tarball download, checksum fetch, etc.).
	u.HTTPClient = &http.Client{Timeout: 30 * time.Second}
	return u.HTTPClient
}

// doGet performs an authenticated GET request and returns the response.
// The caller is responsible for closing resp.Body.
func (u *Updater) doGet(ctx context.Context, url, userAgent string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)

	resp, err := u.httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}
	return resp, nil
}

func (u *Updater) apiEndpoint() string {
	if u.APIEndpoint != "" {
		return u.APIEndpoint
	}
	return githubAPIURL
}

func (u *Updater) binaryName() string {
	if u.BinaryName != "" {
		return u.BinaryName
	}
	name := "qurl-frpc"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return name
}

// assetName returns the expected tarball filename for this platform.
func assetName(tag string) string {
	return fmt.Sprintf("qurl-reverse-proxy-%s-%s-%s.tar.gz", tag, runtime.GOOS, runtime.GOARCH)
}

// CheckForUpdate queries the GitHub Releases API for the latest version
// and compares it against currentVersion.
func (u *Updater) CheckForUpdate(ctx context.Context, currentVersion string) (*UpdateInfo, error) {
	current, err := Parse(currentVersion)
	if err != nil {
		return nil, fmt.Errorf("parse current version: %w", err)
	}

	// Dev builds never trigger updates.
	if current.IsDev() {
		return &UpdateInfo{
			CurrentVersion: currentVersion,
			LatestVersion:  currentVersion,
			Available:      false,
		}, nil
	}

	ua := "qurl-frpc/" + currentVersion
	resp, err := u.doGet(ctx, u.apiEndpoint(), ua)
	if err != nil {
		return nil, fmt.Errorf("fetch latest release: %w", err)
	}
	defer resp.Body.Close()

	var release releaseResponse
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, fmt.Errorf("decode release response: %w", err)
	}

	latest, err := Parse(release.TagName)
	if err != nil {
		return nil, fmt.Errorf("parse release version %q: %w", release.TagName, err)
	}

	info := &UpdateInfo{
		CurrentVersion: current.String(),
		LatestVersion:  latest.String(),
		Available:      latest.NewerThan(current),
		ReleaseURL:     release.HTMLURL,
	}

	// Find the matching asset for this platform.
	wantAsset := assetName(release.TagName)
	for _, a := range release.Assets {
		if a.Name == wantAsset {
			info.AssetURL = a.BrowserDownloadURL
			break
		}
	}

	return info, nil
}

// Download fetches the release tarball, verifies its SHA256 checksum against
// the release's SHA256SUMS file, and extracts it to a staging directory within
// destDir. It returns the path to the staging directory. The caller should
// later call Apply to swap the staged files into place, or CleanStaging to
// discard them.
func (u *Updater) Download(ctx context.Context, info *UpdateInfo, destDir string) (string, error) {
	if info.AssetURL == "" {
		return "", fmt.Errorf("no download URL for %s/%s", runtime.GOOS, runtime.GOARCH)
	}

	stagingDir := filepath.Join(destDir, stagingDirName)

	// Clean any previous staging attempt.
	_ = os.RemoveAll(stagingDir)
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		return "", fmt.Errorf("create staging dir: %w", err)
	}

	cleanup := func() { _ = os.RemoveAll(stagingDir) }
	ua := "qurl-frpc/" + info.CurrentVersion

	tarballPath := filepath.Join(stagingDir, "release.tar.gz")
	if err := u.downloadToFile(ctx, info.AssetURL, ua, tarballPath); err != nil {
		cleanup()
		return "", fmt.Errorf("download release: %w", err)
	}

	wantAsset := assetName(info.LatestVersion)
	if err := u.verifyChecksum(ctx, info.LatestVersion, ua, tarballPath, wantAsset); err != nil {
		cleanup()
		return "", err
	}

	// Extract verified tarball.
	f, err := os.Open(tarballPath)
	if err != nil {
		cleanup()
		return "", fmt.Errorf("open tarball: %w", err)
	}
	extractErr := extractTarGz(f, stagingDir, u.binaryName())
	_ = f.Close()
	_ = os.Remove(tarballPath)

	if extractErr != nil {
		cleanup()
		return "", fmt.Errorf("extract tarball: %w", extractErr)
	}

	// Verify the binary was extracted.
	binaryPath := filepath.Join(stagingDir, u.binaryName())
	if _, err := os.Stat(binaryPath); os.IsNotExist(err) {
		cleanup()
		return "", fmt.Errorf("binary %q not found in release tarball", u.binaryName())
	}

	return stagingDir, nil
}

// downloadToFile fetches url and writes the response body to destPath.
func (u *Updater) downloadToFile(ctx context.Context, url, ua, destPath string) error {
	resp, err := u.doGet(ctx, url, ua)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	f, err := os.Create(destPath)
	if err != nil {
		return err
	}

	_, copyErr := io.Copy(f, io.LimitReader(resp.Body, maxDownloadSize))
	closeErr := f.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func (u *Updater) checksumURL(tag string) string {
	base := u.ChecksumBaseURL
	if base == "" {
		base = "https://github.com/" + GitHubRepo + "/releases/download"
	}
	return base + "/" + tag + "/SHA256SUMS"
}

// verifyChecksum downloads the SHA256SUMS file for the release and verifies the
// tarball hash matches.
func (u *Updater) verifyChecksum(ctx context.Context, tag, ua, tarballPath, expectedAsset string) error {
	expected, err := u.fetchExpectedHash(ctx, tag, ua, expectedAsset)
	if err != nil {
		return fmt.Errorf("checksum verification failed: %w", err)
	}

	actual, err := fileSHA256(tarballPath)
	if err != nil {
		return fmt.Errorf("compute checksum: %w", err)
	}

	if actual != expected {
		return fmt.Errorf("checksum mismatch: expected %s, got %s", expected, actual)
	}

	return nil
}

// fetchExpectedHash downloads SHA256SUMS and returns the expected hash for assetName.
func (u *Updater) fetchExpectedHash(ctx context.Context, tag, ua, wantAsset string) (string, error) {
	resp, err := u.doGet(ctx, u.checksumURL(tag), ua)
	if err != nil {
		return "", fmt.Errorf("fetch SHA256SUMS: %w", err)
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		parts := strings.Fields(scanner.Text())
		if len(parts) >= 2 && parts[len(parts)-1] == wantAsset {
			return parts[0], nil
		}
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("read SHA256SUMS: %w", err)
	}

	return "", fmt.Errorf("asset %q not found in SHA256SUMS", wantAsset)
}

// fileSHA256 computes the hex-encoded SHA256 hash of a file.
func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// fileBackup tracks a file that was renamed during Apply for rollback.
type fileBackup struct {
	original string
	backup   string
}

// Apply moves staged files from stagingDir into installDir, replacing
// existing files. It backs up the current binary and restores it on failure.
func Apply(stagingDir, installDir string) error {
	entries, err := os.ReadDir(stagingDir)
	if err != nil {
		return fmt.Errorf("read staging dir: %w", err)
	}

	var backups []fileBackup

	rollback := func() {
		for _, b := range backups {
			_ = os.Remove(b.original)
			_ = os.Rename(b.backup, b.original)
		}
	}

	for _, entry := range entries {
		if entry.IsDir() {
			// Handle sdk/ directory.
			if err := applyStagedDir(stagingDir, installDir, entry.Name(), &backups); err != nil {
				rollback()
				return err
			}
			continue
		}

		srcPath := filepath.Join(stagingDir, entry.Name())
		dstPath := filepath.Join(installDir, entry.Name())
		bakPath := dstPath + backupSuffix

		// Back up existing file if it exists.
		if _, err := os.Stat(dstPath); err == nil {
			if err := os.Rename(dstPath, bakPath); err != nil {
				rollback()
				return fmt.Errorf("backup %s: %w", entry.Name(), wrapPermissionError(err))
			}
			backups = append(backups, fileBackup{original: dstPath, backup: bakPath})
		}

		// Move staged file into place.
		if err := moveFile(srcPath, dstPath); err != nil {
			rollback()
			return fmt.Errorf("install %s: %w", entry.Name(), wrapPermissionError(err))
		}
	}

	// All files installed successfully — clean up backups and staging.
	for _, b := range backups {
		_ = os.Remove(b.backup)
	}
	_ = os.RemoveAll(stagingDir)

	return nil
}

// applyStagedDir handles a subdirectory (like sdk/) in the staging area.
func applyStagedDir(stagingDir, installDir, dirName string, backups *[]fileBackup) error {
	srcDir := filepath.Join(stagingDir, dirName)
	dstDir := filepath.Join(installDir, dirName)

	if err := os.MkdirAll(dstDir, 0o755); err != nil {
		return fmt.Errorf("create %s dir: %w", dirName, err)
	}

	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return fmt.Errorf("read staged %s: %w", dirName, err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue // only one level deep
		}

		srcPath := filepath.Join(srcDir, entry.Name())
		dstPath := filepath.Join(dstDir, entry.Name())
		bakPath := dstPath + backupSuffix

		if _, err := os.Stat(dstPath); err == nil {
			if err := os.Rename(dstPath, bakPath); err != nil {
				return fmt.Errorf("backup %s/%s: %w", dirName, entry.Name(), wrapPermissionError(err))
			}
			*backups = append(*backups, fileBackup{original: dstPath, backup: bakPath})
		}

		if err := moveFile(srcPath, dstPath); err != nil {
			return fmt.Errorf("install %s/%s: %w", dirName, entry.Name(), wrapPermissionError(err))
		}
	}

	return nil
}

// CleanStaging removes any leftover staging directory.
func CleanStaging(installDir string) error {
	return os.RemoveAll(filepath.Join(installDir, stagingDirName))
}

// HasStagedUpdate reports whether a staged update exists and returns the
// path to the staged binary if so.
func HasStagedUpdate(installDir, binaryName string) (string, bool) {
	staged := filepath.Join(installDir, stagingDirName, binaryName)
	if _, err := os.Stat(staged); err == nil {
		return filepath.Join(installDir, stagingDirName), true
	}
	return "", false
}

// extractTarGz reads a gzip-compressed tar stream and extracts the binary
// and sdk/ files to destDir.
func extractTarGz(r io.Reader, destDir, binaryName string) error {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return fmt.Errorf("gzip reader: %w", err)
	}
	defer func() { _ = gz.Close() }()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read tar entry: %w", err)
		}

		// Sanitize path to prevent directory traversal.
		name := filepath.Clean(hdr.Name)
		if strings.HasPrefix(name, "..") || filepath.IsAbs(name) {
			continue
		}

		// We only care about:
		// - The main binary (qurl-frpc)
		// - SDK shared libraries and headers (sdk/*)
		base := filepath.Base(name)
		dir := filepath.Dir(name)
		isSDK := dir == "sdk" || strings.HasPrefix(dir, "sdk/")
		isBinary := base == binaryName && (dir == "." || dir == "/")

		if !isBinary && !isSDK {
			continue
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			target := filepath.Join(destDir, name)
			if err := os.MkdirAll(target, 0o755); err != nil {
				return fmt.Errorf("mkdir %s: %w", name, err)
			}

		case tar.TypeReg:
			target := filepath.Join(destDir, name)
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return fmt.Errorf("mkdir for %s: %w", name, err)
			}

			mode := os.FileMode(hdr.Mode)
			if isBinary || mode&0o111 != 0 {
				mode = 0o755
			} else {
				mode = 0o644
			}

			f, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
			if err != nil {
				return fmt.Errorf("create %s: %w", name, err)
			}

			if _, err := io.Copy(f, tr); err != nil {
				_ = f.Close()
				return fmt.Errorf("write %s: %w", name, err)
			}
			if err := f.Close(); err != nil {
				return fmt.Errorf("close %s: %w", name, err)
			}
		}
	}

	return nil
}

// moveFile tries os.Rename first (atomic on same filesystem), falling back
// to copy+remove for cross-device moves.
func moveFile(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}

	// Cross-device fallback: copy then remove.
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()

	info, err := in.Stat()
	if err != nil {
		return err
	}

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode())
	if err != nil {
		return err
	}

	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		_ = os.Remove(dst)
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}

	return os.Remove(src)
}

// wrapPermissionError adds a helpful hint for permission-denied errors.
func wrapPermissionError(err error) error {
	if os.IsPermission(err) {
		return fmt.Errorf("%w (try running with sudo)", err)
	}
	return err
}
