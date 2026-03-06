#!/bin/bash
# Build OpenNHP SDK (nhp-agent.dll) on Windows via MSYS2.
# Called by build.bat with arguments (Windows paths with backslashes):
#   $1 = GOROOT  $2 = GOPATH  $3 = GOMODCACHE  $4 = GOCACHE
#   $5 = PROJECT_DIR  $6 = OPENNHP_DIR  $7 = TEMP dir
set -e

# Convert Windows path to MSYS2 path for bash: C:\foo -> /c/foo
to_msys() {
  local p
  p="$(echo "$1" | tr '\\' '/')"
  if [[ "$p" =~ ^([A-Za-z]):/ ]]; then
    local drive
    drive="$(echo "${BASH_REMATCH[1]}" | tr 'A-Z' 'a-z')"
    p="/${drive}${p:2}"
  fi
  echo "$p"
}

# Convert \ to / (keep drive letter for Go, which is a Windows binary)
to_fwd() { echo "$1" | tr '\\' '/'; }

# Go is a Windows binary — it needs Windows-style paths (forward slashes OK)
export GOROOT="$(to_fwd "$1")"
export GOPATH="$(to_fwd "$2")"
export GOMODCACHE="$(to_fwd "$3")"
export GOCACHE="$(to_fwd "$4")"
export GOTMPDIR="$(to_fwd "$7")"
export TEMP="$(to_fwd "$7")"
export TMP="$(to_fwd "$7")"

# For PATH (used by bash to locate go.exe), use MSYS2-style paths
export PATH="$(to_msys "$1")/bin:$PATH"

PROJECT_DIR="$(to_msys "$5")"
OPENNHP_DIR="$(to_msys "$6")"

echo "Using Go: $(go version)"
cd "$PROJECT_DIR/$OPENNHP_DIR"

cd nhp && go mod tidy && cd ..
cd endpoints && go mod tidy

CGO_ENABLED=1 CC=gcc go build -a -trimpath -buildmode=c-shared \
  -ldflags="-w -s" -v \
  -o ../../../bin/sdk/nhp-agent.dll \
  ./agent/main/main.go ./agent/main/export.go
