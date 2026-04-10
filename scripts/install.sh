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

# --- Download and extract ---
download_and_extract() {
  TARBALL="qurl-reverse-proxy-${VERSION}-${GOOS}-${GOARCH}.tar.gz"
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${TARBALL}"
  TMPDIR=$(mktemp -d)

  info "Downloading ${TARBALL}..."

  if command -v curl >/dev/null 2>&1; then
    curl -sSL -o "${TMPDIR}/${TARBALL}" "$DOWNLOAD_URL" || error "Download failed. URL: ${DOWNLOAD_URL}"
  else
    wget -q -O "${TMPDIR}/${TARBALL}" "$DOWNLOAD_URL" || error "Download failed. URL: ${DOWNLOAD_URL}"
  fi

  info "Extracting to ${INSTALL_DIR}..."

  # Create install directory (may need sudo)
  if [ -w "$(dirname "$INSTALL_DIR")" ]; then
    mkdir -p "$INSTALL_DIR"
  else
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown "$(whoami)" "$INSTALL_DIR"
  fi

  tar xzf "${TMPDIR}/${TARBALL}" -C "$INSTALL_DIR" --strip-components=0

  rm -rf "$TMPDIR"
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
  download_and_extract
  create_symlink
  configure_token
  verify_installation
  print_success
}

main
