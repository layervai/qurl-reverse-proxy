# Auto-Update Setup Guide

This document covers the human steps required to get seamless auto-updates working for both the **CLI** (`qurl-frpc`) and the **Desktop App** (QURL Desktop).

---

## Architecture Overview

| Component | Update mechanism | Hosting | User action |
|-----------|-----------------|---------|-------------|
| **CLI** (`qurl-frpc update`) | Custom Go self-updater via GitHub Releases API | GitHub Releases | Run `qurl-frpc update` manually |
| **Desktop: tunnel binary** | Custom TypeScript updater, background download | GitHub Releases | Click "Relaunch" in sidebar banner |
| **Desktop: app itself** | `electron-updater` via GitHub Releases | GitHub Releases | Click "Relaunch" in sidebar banner |

All update channels use **GitHub Releases** as the backend. No custom update server or CDN is required.

---

## 1. macOS Code Signing (Required)

macOS auto-updates require the app to be code-signed. Without a valid signature, Gatekeeper will block the updated app from launching.

### Steps

1. **Enroll in Apple Developer Program** ($99/year)
   - https://developer.apple.com/programs/

2. **Create a "Developer ID Application" certificate**
   - Open Xcode > Settings > Accounts > Manage Certificates
   - Or use the Apple Developer portal: Certificates, Identifiers & Profiles

3. **Export the certificate as `.p12`**
   - In Keychain Access, find "Developer ID Application: Your Name"
   - Right-click > Export > save as `.p12` with a password

4. **Base64-encode the certificate**
   ```bash
   base64 -i Certificates.p12 | pbcopy
   ```

5. **Add GitHub repository secrets**

   | Secret | Value |
   |--------|-------|
   | `MAC_CERTIFICATE` | Base64-encoded `.p12` certificate |
   | `MAC_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |

---

## 2. Apple Notarization (Required for macOS)

Notarization is required for apps distributed outside the Mac App Store on macOS 10.15+. `electron-builder` handles notarization automatically when the environment variables are set.

### Steps

1. **Create an app-specific password**
   - Go to https://appleid.apple.com > Sign-In and Security > App-Specific Passwords
   - Generate a new password for "QURL Desktop CI"

2. **Find your Team ID**
   - Apple Developer portal > Membership > Team ID (10-character string)

3. **Add GitHub repository secrets**

   | Secret | Value |
   |--------|-------|
   | `APPLE_ID` | Your Apple ID email |
   | `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from step 1 |
   | `APPLE_TEAM_ID` | 10-character Team ID |

---

## 3. Windows Code Signing (Optional)

Windows code signing is recommended to avoid SmartScreen warnings but is not strictly required for auto-updates to function.

### Options

- **EV Code Signing Certificate** (from DigiCert, Sectigo, etc.) - most trusted, hardware token required
- **Azure Trusted Signing** - cloud-based, cheaper alternative

### Steps (if using EV certificate)

1. Purchase an EV code signing certificate
2. Export as `.pfx`
3. Base64-encode and add as GitHub secrets:

   | Secret | Value |
   |--------|-------|
   | `WIN_CSC_LINK` | Base64-encoded `.pfx` certificate |
   | `WIN_CSC_KEY_PASSWORD` | Certificate password |

---

## 4. GPG Release Signing (Required)

Release tarballs are accompanied by a `SHA256SUMS` file and its GPG signature (`SHA256SUMS.asc`). This allows users and the desktop updater to verify download integrity.

### Steps

1. **Generate a dedicated signing key** (no passphrase for CI, or with a passphrase stored as a secret)
   ```bash
   gpg --full-generate-key
   # Choose: RSA (sign only), 4096 bits
   # Name: QURL Release Signing
   # Email: releases@layerv.ai
   ```

2. **Export the private key**
   ```bash
   gpg --armor --export-secret-keys "QURL Release Signing" > qurl-release-signing.asc
   ```

3. **Add GitHub repository secrets**

   | Secret | Value |
   |--------|-------|
   | `GPG_PRIVATE_KEY` | Contents of `qurl-release-signing.asc` (ASCII-armored private key) |
   | `GPG_PASSPHRASE` | Key passphrase (leave empty if no passphrase) |

4. **Publish the public key** for users who want to verify signatures
   ```bash
   gpg --armor --export "QURL Release Signing"
   ```
   Add this to the project README or a `SECURITY.md` file so users can import it with `gpg --import`.

### How verification works

- **install.sh**: Automatically verifies `SHA256SUMS` on download. GPG signature check is best-effort (only if `gpg` is installed and the key is imported).
- **Desktop app**: The sidecar updater verifies tarball SHA256 against `SHA256SUMS` before applying updates. Mismatches abort the update.
- **Manual verification**:
  ```bash
  # Download release files
  curl -LO https://github.com/layervai/qurl-reverse-proxy/releases/download/v1.2.3/SHA256SUMS
  curl -LO https://github.com/layervai/qurl-reverse-proxy/releases/download/v1.2.3/SHA256SUMS.asc

  # Verify checksums
  sha256sum -c SHA256SUMS

  # Verify GPG signature (after importing the public key)
  gpg --verify SHA256SUMS.asc SHA256SUMS
  ```

---

## 5. GitHub Token (Automatic)

The `GITHUB_TOKEN` provided automatically by GitHub Actions has sufficient permissions to publish release assets to the same repository, as long as the workflow has `contents: write` permission (already configured in `release.yml`).

No additional token configuration is needed.

---

## 6. Version Management

The desktop app version and Git tag must stay in sync:

- **Git tags**: `v1.2.3` (with `v` prefix)
- **`desktop/package.json` version**: `1.2.3` (without prefix)

The CI workflow automatically syncs the version:
```bash
VERSION="${GITHUB_REF_NAME#v}"
npm version "$VERSION" --no-git-tag-version --allow-same-version
```

Before tagging a release, **you do not need to manually bump `desktop/package.json`** -- CI does it. But the version in `package.json` on `main` should reflect the last released version for local development clarity.

### CLI version

Set at build time via ldflags -- no manual step needed:
```
-X 'pkg/version.Version=$TAG'
```

---

## 7. Release Process

1. **Tag and push**
   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```

2. **CI runs automatically** (`release.yml`):
   - `build-release` job: builds Go binaries (CLI + server) for linux/amd64 and darwin/arm64
   - `create-release` job: creates GitHub Release with Go tarballs
   - `build-desktop` job: builds desktop installers using electron-builder, publishes to the same GitHub Release

3. **electron-builder publishes these assets**:
   - macOS: `QURL Desktop-{version}-arm64.dmg`, `QURL Desktop-{version}-arm64-mac.zip`, `latest-mac.yml`
   - Linux: `QURL Desktop-{version}.AppImage`, `QURL Desktop-{version}_amd64.deb`, `latest-linux.yml`
   - Windows (when enabled): `QURL Desktop Setup {version}.exe`, `latest.yml`

4. **Existing installs auto-detect the update**:
   - `electron-updater` reads `latest-mac.yml` / `latest-linux.yml` / `latest.yml` from GitHub Releases
   - Downloads the new installer in the background
   - Shows "Relaunch" banner to the user

---

## 8. How Auto-Updates Work at Runtime

### Desktop app update flow

```
App launches
    |
    v
30s delay -> check GitHub Releases (every 4h after)
    |
    +--- Sidecar binary: custom logic downloads tarball, stages in ~/.config/qurl/.update-staging/
    |       -> "Updated to vX.Y.Z - Relaunch" banner
    |       -> User clicks Relaunch -> atomic binary swap -> sidecar restarts
    |
    +--- App itself: electron-updater downloads new installer in background
            -> "Updated to vX.Y.Z - Relaunch" banner
            -> User clicks Relaunch -> app quits, installer runs, app relaunches
```

### CLI update flow

```
User runs: qurl-frpc update
    |
    v
Query GitHub Releases API for latest tag
    |
    v
Download platform-specific tarball
    |
    v
Atomic binary swap with rollback on failure
```

---

## 9. Testing Auto-Updates Locally

### Without code signing (development)

Set this environment variable to skip signature verification:
```bash
export ELECTRON_UPDATER_ALLOW_UNSIGNED=1
```

Then:
1. Build a packaged (but unsigned) app: `cd desktop && npm run pack`
2. Create a **draft** GitHub Release with a higher version number
3. Upload a manually built `.zip` and `latest-mac.yml` to the draft release
4. Run the packaged app -- it should detect the update

### `latest-mac.yml` format

electron-builder generates this automatically during CI, but for manual testing you can create one:
```yaml
version: 1.3.0
files:
  - url: QURL Desktop-1.3.0-arm64-mac.zip
    sha512: <sha512-hash>
    size: <size-in-bytes>
path: QURL Desktop-1.3.0-arm64-mac.zip
sha512: <sha512-hash>
releaseDate: '2026-04-10T00:00:00.000Z'
```

Generate the sha512:
```bash
shasum -a 512 "QURL Desktop-1.3.0-arm64-mac.zip" | awk '{print $1}' | xxd -r -p | base64
```

### CLI update testing

```bash
# Check for updates without installing
./bin/qurl-frpc update --check

# Full update
./bin/qurl-frpc update
```

---

## 10. Troubleshooting

### "Update available" but download fails

- Check GitHub API rate limits (60 req/hr unauthenticated). The updater uses ETag caching to minimize calls.
- Ensure the release assets match the expected naming: `qurl-reverse-proxy-{tag}-{os}-{arch}.tar.gz` for sidecar, and electron-builder's default names for app installers.

### macOS: "App is damaged" after update

- The app is not properly code-signed. Ensure `MAC_CERTIFICATE` and `MAC_CERTIFICATE_PASSWORD` secrets are set.
- Verify notarization succeeded in the CI logs.

### macOS: Notarization fails in CI

- Ensure `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are all set correctly.
- The Apple ID must have accepted the latest Apple Developer Program License Agreement.
- App-specific passwords expire if unused for extended periods -- regenerate if needed.

### electron-updater not finding updates

- electron-updater looks for `latest-mac.yml` (or `latest-linux.yml` / `latest.yml`) in the GitHub Release assets.
- These files are generated and uploaded by `electron-builder --publish always`. If you create a release manually, you need to upload them too.
- Ensure the `publish` config in `electron-builder.yml` matches the actual repo owner/name.

### Dev mode: "App auto-update is only available in packaged builds"

This is expected. In development (`npm run dev` / `npm start`), the app falls back to showing a "Download" link to GitHub releases instead of auto-downloading. Use `npm run pack` to test with a packaged build.

---

## 11. Secrets Checklist

All secrets are configured in: **GitHub repo > Settings > Secrets and variables > Actions**

| Secret | Required | Purpose |
|--------|----------|---------|
| `MAC_CERTIFICATE` | Yes (macOS) | Base64 `.p12` Developer ID Application cert |
| `MAC_CERTIFICATE_PASSWORD` | Yes (macOS) | `.p12` export password |
| `APPLE_ID` | Yes (macOS) | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | Yes (macOS) | App-specific password for notarization |
| `APPLE_TEAM_ID` | Yes (macOS) | Apple Developer Team ID |
| `GPG_PRIVATE_KEY` | Yes | ASCII-armored GPG private key for checksum signing |
| `GPG_PASSPHRASE` | Yes (can be empty) | Passphrase for the GPG key |
| `WIN_CSC_LINK` | Optional | Base64 `.pfx` Windows code signing cert |
| `WIN_CSC_KEY_PASSWORD` | Optional | Windows cert password |
| `GITHUB_TOKEN` | Automatic | Provided by GitHub Actions, no setup needed |

---

## 12. Dependency Notes

### `@layerv/qurl` local reference

`desktop/package.json` references `"@layerv/qurl": "file:../../qurl-typescript"`. In CI, the release workflow clones `qurl-typescript` one level above the workspace root so this path resolves. If the SDK is published to npm in the future, update the reference to the published version and remove the `git clone` step from `release.yml`. If `qurl-typescript` becomes a private repo, add a `QURL_SDK_TOKEN` secret with read access.

### Key packages

| Package | Role | Where |
|---------|------|-------|
| `electron-updater` | Runtime: checks, downloads, and applies app updates | `dependencies` |
| `electron-builder` | Build-time: packages the app into `.dmg`/`.exe`/`.AppImage` | `devDependencies` |
