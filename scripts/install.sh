#!/bin/sh
# QURL Reverse Proxy Client — Installer Script
# Usage: curl -sSL https://get.layerv.ai/frpc | sh -s -- [--token TOKEN]
#
# Environment variables:
#   QURL_INSTALL_DIR  Override install directory (default: /usr/local/lib/qurl)
#   QURL_BIN_DIR      Override symlink directory (default: /usr/local/bin)

set -e

REPO="layervai/qurl-reverse-proxy"
INSTALL_DIR="${QURL_INSTALL_DIR:-/usr/local/lib/qurl}"
BIN_DIR="${QURL_BIN_DIR:-/usr/local/bin}"
CONFIG_DIR="${HOME}/.config/qurl"
BINARY_NAME="qurl-frpc"

# Colors (only if terminal supports them)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  RED='' GREEN='' CYAN='' BOLD='' RESET=''
fi

info() { printf "${CYAN}==> %s${RESET}\n" "$1"; }
success() { printf "${GREEN}==> %s${RESET}\n" "$1"; }
error() { printf "${RED}Error: %s${RESET}\n" "$1" >&2; exit 1; }

# Download a URL to a local file. Exits on failure unless quiet=true.
# Usage: fetch_file URL DEST [quiet]
fetch_file() {
  _url="$1" _dest="$2" _quiet="${3:-false}"
  if command -v curl >/dev/null 2>&1; then
    curl -sSL -o "$_dest" "$_url" 2>/dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$_dest" "$_url" 2>/dev/null
  else
    error "Neither curl nor wget found. Please install one of them."
  fi
  if [ "$_quiet" != "true" ] && { [ ! -f "$_dest" ] || [ ! -s "$_dest" ]; }; then
    error "Download failed. URL: ${_url}"
  fi
}

# --- Parse arguments ---
TOKEN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    --token=*) TOKEN="${1#*=}"; shift ;;
    --help|-h)
      echo "Usage: curl -sSL https://get.layerv.ai/frpc | sh -s -- [--token TOKEN]"
      echo ""
      echo "Options:"
      echo "  --token TOKEN   QURL API token (saved to ~/.config/qurl/token)"
      exit 0
      ;;
    *) shift ;;
  esac
done

# --- Detect platform ---
detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Linux)  GOOS="linux" ;;
    Darwin) GOOS="darwin" ;;
    *)      error "Unsupported operating system: $OS" ;;
  esac

  case "$ARCH" in
    x86_64|amd64)  GOARCH="amd64" ;;
    aarch64|arm64) GOARCH="arm64" ;;
    *)             error "Unsupported architecture: $ARCH" ;;
  esac

  info "Detected platform: ${GOOS}-${GOARCH}"
}

# --- Get latest version ---
get_latest_version() {
  info "Fetching latest version..."

  if command -v curl >/dev/null 2>&1; then
    VERSION=$(curl -sSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"//;s/".*//')
  elif command -v wget >/dev/null 2>&1; then
    VERSION=$(wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"//;s/".*//')
  else
    error "Neither curl nor wget found. Please install one of them."
  fi

  if [ -z "$VERSION" ]; then
    error "Could not determine latest version. Check https://github.com/${REPO}/releases"
  fi

  info "Latest version: ${VERSION}"
}

# --- Download tarball ---
download_tarball() {
  TARBALL="qurl-reverse-proxy-${VERSION}-${GOOS}-${GOARCH}.tar.gz"
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${TARBALL}"
  DL_DIR=$(mktemp -d)

  info "Downloading ${TARBALL}..."
  fetch_file "$DOWNLOAD_URL" "${DL_DIR}/${TARBALL}"
}

# --- Verify checksum ---
verify_checksum() {
  info "Verifying checksum..."

  fetch_file "https://github.com/${REPO}/releases/download/${VERSION}/SHA256SUMS" "${DL_DIR}/SHA256SUMS" true

  if [ ! -f "${DL_DIR}/SHA256SUMS" ] || [ ! -s "${DL_DIR}/SHA256SUMS" ]; then
    info "No SHA256SUMS found in release — skipping checksum verification"
    return 0
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_HASH=$(sha256sum "${DL_DIR}/${TARBALL}" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL_HASH=$(shasum -a 256 "${DL_DIR}/${TARBALL}" | awk '{print $1}')
  else
    info "No sha256sum or shasum available — skipping checksum verification"
    return 0
  fi

  EXPECTED_HASH=$(grep "${TARBALL}" "${DL_DIR}/SHA256SUMS" | awk '{print $1}')

  if [ -z "$EXPECTED_HASH" ]; then
    info "Tarball not found in SHA256SUMS — skipping checksum verification"
    return 0
  fi

  if [ "$ACTUAL_HASH" != "$EXPECTED_HASH" ]; then
    error "Checksum mismatch! Expected ${EXPECTED_HASH}, got ${ACTUAL_HASH}. The download may be corrupted."
  fi

  success "Checksum verified"

  # GPG signature verification (best-effort, only if gpg is installed)
  if command -v gpg >/dev/null 2>&1; then
    fetch_file "https://github.com/${REPO}/releases/download/${VERSION}/SHA256SUMS.asc" "${DL_DIR}/SHA256SUMS.asc" true

    if [ -f "${DL_DIR}/SHA256SUMS.asc" ] && [ -s "${DL_DIR}/SHA256SUMS.asc" ]; then
      if gpg --verify "${DL_DIR}/SHA256SUMS.asc" "${DL_DIR}/SHA256SUMS" 2>/dev/null; then
        success "GPG signature verified"
      else
        info "GPG signature could not be verified (signing key may not be imported)"
      fi
    fi
  fi
}

# --- Extract tarball ---
extract_tarball() {
  info "Extracting to ${INSTALL_DIR}..."

  # Create install directory (may need sudo)
  if [ -w "$(dirname "$INSTALL_DIR")" ]; then
    mkdir -p "$INSTALL_DIR"
  else
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown "$(whoami)" "$INSTALL_DIR"
  fi

  tar xzf "${DL_DIR}/${TARBALL}" -C "$INSTALL_DIR" --strip-components=0

  rm -rf "$DL_DIR"
}

# --- Create symlink ---
create_symlink() {
  info "Creating symlink in ${BIN_DIR}..."

  if [ -w "$BIN_DIR" ]; then
    ln -sf "${INSTALL_DIR}/${BINARY_NAME}" "${BIN_DIR}/${BINARY_NAME}"
  else
    sudo ln -sf "${INSTALL_DIR}/${BINARY_NAME}" "${BIN_DIR}/${BINARY_NAME}"
  fi
}

# --- Configure token ---
configure_token() {
  if [ -n "$TOKEN" ]; then
    info "Saving API token..."
    mkdir -p "$CONFIG_DIR"
    echo "$TOKEN" > "${CONFIG_DIR}/token"
    chmod 600 "${CONFIG_DIR}/token"

    # Also set env var hint
    SHELL_NAME="$(basename "$SHELL")"
    case "$SHELL_NAME" in
      zsh)  PROFILE="$HOME/.zshrc" ;;
      bash) PROFILE="$HOME/.bashrc" ;;
      *)    PROFILE="" ;;
    esac

    if [ -n "$PROFILE" ] && ! grep -q "LAYERV_TOKEN" "$PROFILE" 2>/dev/null; then
      printf '\n# QURL Reverse Proxy\nexport LAYERV_TOKEN="%s"\n' "$TOKEN" >> "$PROFILE"
      info "Added LAYERV_TOKEN to ${PROFILE}"
    fi
  fi
}

# --- Verify installation ---
verify_installation() {
  if ! command -v "$BINARY_NAME" >/dev/null 2>&1; then
    # Try direct path
    if [ -x "${INSTALL_DIR}/${BINARY_NAME}" ]; then
      info "Binary installed but not in PATH. Add ${BIN_DIR} to your PATH."
    else
      error "Installation verification failed. Binary not found."
    fi
  fi
}

# --- Print success ---
print_success() {
  echo ""
  success "QURL Reverse Proxy client installed successfully!"
  echo ""
  printf "  ${BOLD}Get started:${RESET}\n"
  echo ""
  if [ -z "$TOKEN" ]; then
    echo "    export LAYERV_TOKEN=\"your-api-token\""
  fi
  echo "    ${BINARY_NAME} add --target http://localhost:8080 --name \"My App\""
  echo "    ${BINARY_NAME} run"
  echo ""
  printf "  ${BOLD}Other commands:${RESET}\n"
  echo "    ${BINARY_NAME} list       List configured routes"
  echo "    ${BINARY_NAME} status     Show tunnel status"
  echo "    ${BINARY_NAME} version    Show version info"
  echo ""
}

# --- Main ---
main() {
  printf "\n${BOLD}${CYAN}  QURL Reverse Proxy — Installer${RESET}\n\n"

  detect_platform
  get_latest_version
  download_tarball
  verify_checksum
  extract_tarball
  create_symlink
  configure_token
  verify_installation
  print_success
}

main
