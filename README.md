# QURL Reverse Proxy

[English](README.md) | [中文](README_zh.md)

QURL Reverse Proxy is a zero-trust reverse proxy that integrates [OpenNHP](https://github.com/OpenNHP/opennhp) (Network Hiding Protocol) with [frp](https://github.com/fatedier/frp) to provide secure, time-limited access to private services through [QURL](https://layerv.ai) links.

## Quick Start

```bash
# Build
make

# Run the client
./bin/qurl-frpc run

# Add a local service
./bin/qurl-frpc add --target http://localhost:8080 --name "My App"
```

## Architecture

```
  Your Machine                        QURL Platform                    Browser
┌─────────────────┐                 ┌─────────────────────────┐
│                 │  1. NHP Knock   │                         │
│  NHP Agent ─────│────── UDP ─────>│  NHP Server             │
│                 │                 │    │ verify + open fw   │
│                 │  2. FRP Tunnel  │    v                    │
│  FRP Client ────│──── TCP:7000 ──>│  qurl-frps (:7000)     │
│    │            │                 │    │                    │     ┌──────────┐
│    │ proxy      │                 │    │ session validate   │<────│ Browser  │
│    v            │                 │    v                    │     └──────────┘
│  Local Service  │<── HTTP ────────│  qurl.link             │
│  (:8080)        │  via FRP tunnel │                         │
└─────────────────┘                 └─────────────────────────┘
```

## Components

| Binary | Description |
|--------|-------------|
| `qurl-frpc` | Client with built-in NHP Agent -- performs NHP knock before connecting |
| `qurl-frps` | Server (thin FRP wrapper with session validation) |

## Building

### Prerequisites

- **Go** 1.25+
- **GCC** (for NHP SDK shared library via CGO)

### Build

```bash
# Build everything
make

# Individual targets
make frps        # Server only (no CGO)
make frpc        # Client + SDK (CGO required)
make test        # Run tests
```

## Configuration

QURL Reverse Proxy uses a YAML configuration file (`qurl-proxy.yaml`):

```yaml
server:
  addr: proxy.layerv.ai
  port: 7000
  token: ${LAYERV_TOKEN}

nhp:
  enabled: true

routes:
  - name: my-webapp
    type: frp_http
    local_port: 8080
    subdomain: my-app
```

Legacy FRP TOML config is also supported for backward compatibility.

## Installation

### One-line install (Linux / macOS)

```bash
curl -sSL https://get.layerv.ai/frpc | sh
```

With an API token:

```bash
curl -sSL https://get.layerv.ai/frpc | sh -s -- --token YOUR_TOKEN
```

The installer downloads the latest release, places binaries in `/usr/local/lib/qurl`, and creates a symlink in `/usr/local/bin`. Override paths with `QURL_INSTALL_DIR` and `QURL_BIN_DIR`.

### Desktop app

The QURL Desktop app bundles the tunnel client with a GUI for managing services, file sharing, and QURLs. See [`desktop/`](desktop/) for development setup.

## Updating

Both the tunnel CLI and the desktop app support automatic updates from GitHub Releases.

### Tunnel CLI (`qurl-frpc`)

```bash
# Check if an update is available
qurl-frpc update --check

# Download and apply the latest version
qurl-frpc update

# Machine-readable output (used by the desktop app)
qurl-frpc update --check --json
```

The `update` command downloads the release tarball for your platform, extracts the new binary and NHP SDK, and replaces them in-place with automatic rollback on failure. Restart `qurl-frpc` after updating.

If the binary is installed in a system directory (e.g. `/usr/local/lib/qurl`), you may need `sudo`:

```bash
sudo qurl-frpc update
```

### Desktop app

The desktop app checks for updates automatically in the background (every 4 hours). When a new version is available:

1. The update is **downloaded silently** to a staging directory
2. A banner appears in the sidebar: **"Updated to vX.Y.Z — Relaunch to apply"**
3. Click **Relaunch** to stop the tunnel, swap the binary, and restart

No manual intervention is needed — the banner only appears once the download is complete and ready to apply.

### Re-running the install script

You can also update by re-running the install script, which always fetches the latest release:

```bash
curl -sSL https://get.layerv.ai/frpc | sh
```

## Releasing a New Version

Releases are automated via GitHub Actions. Both the tunnel binaries and the install script are published to GitHub Releases, which the auto-update system consumes.

### Prerequisites

- Push access to the `main` branch
- All CI checks passing

### Steps

1. **Ensure `main` is up to date** with all changes merged.

2. **Tag the release** with a semver tag:

   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```

3. **The release workflow runs automatically** (`.github/workflows/release.yml`):
   - Builds `qurl-frpc` and `qurl-frps` for **Linux amd64** and **macOS arm64**
   - Builds the NHP SDK shared library for each platform
   - Packages everything into platform-specific tarballs
   - Creates a GitHub Release with auto-generated release notes
   - Attaches the tarballs and `scripts/install.sh`

4. **Verify the release** at `https://github.com/layervai/qurl-reverse-proxy/releases`

### Release artifacts

Each release produces:

```
qurl-reverse-proxy-v1.2.3-linux-amd64.tar.gz
qurl-reverse-proxy-v1.2.3-darwin-arm64.tar.gz
install.sh
```

Each tarball contains:

```
qurl-frpc          # Client binary
qurl-frps          # Server binary
sdk/nhp-agent.*    # NHP shared library (.so or .dylib)
sdk/*.h            # SDK headers
etc/               # Config templates
LICENSE
```

### Version injection

Versions are injected at build time via `-ldflags` into `pkg/version`:

| Variable | Source |
|----------|--------|
| `Version` | Git tag (e.g. `v1.2.3`) |
| `GitCommit` | `git rev-parse HEAD` |
| `BuildDate` | UTC timestamp |
| `NHPVersion` | OpenNHP submodule tag |

### How users receive updates

| User type | How they update |
|-----------|----------------|
| CLI users | `qurl-frpc update` or re-run install script |
| Desktop users | Automatic — banner appears when update is downloaded |
| Install script users | Re-run `curl -sSL https://get.layerv.ai/frpc \| sh` |

### Desktop app releases

The desktop app does not yet have packaged distribution (DMG, AppImage, etc.). Currently:

- The desktop app reads its version from `desktop/package.json`
- The tunnel sidecar binary is auto-updated independently
- Desktop app-only updates show a "Download" link to the GitHub release page

When electron-builder packaging is added, the desktop app will use `electron-updater` for seamless in-place updates.

## Related Projects

- [frp](https://github.com/fatedier/frp) -- Upstream fast reverse proxy
- [OpenNHP](https://github.com/OpenNHP/opennhp) -- Network Hiding Protocol
- [QURL Service](https://github.com/layervai/qurl-service) -- Core QURL API

## License

Apache License 2.0 -- see [LICENSE](LICENSE) for details.

This project builds upon [frp](https://github.com/fatedier/frp) by fatedier (Apache 2.0) and [OpenNHP](https://github.com/OpenNHP/opennhp) by the OpenNHP team.
