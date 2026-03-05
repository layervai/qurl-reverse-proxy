export PATH := $(PATH):`go env GOPATH`/bin
export GO111MODULE=on
LDFLAGS := -s -w
OS_NAME = $(shell uname -s | tr A-Z a-z)
# OpenNHP submodule directory
OPENNHP_DIR = third_party/opennhp

all: env build

build: frps frpc

env:
	@go version

fmt:
	go fmt ./...

frps:
	env CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -tags frps -o bin/nhp-frps ./cmd/frps

# Build OpenNHP SDK from submodule
build-sdk:
	@echo "[Nhp-frp] Building OpenNHP SDK from submodule..."
ifeq ($(OS_NAME), linux)
	@$(MAKE) build-sdk-linux
else ifeq ($(OS_NAME), darwin)
	@$(MAKE) build-sdk-macos
else
	@echo "[nhp-frp] Skipping SDK build on ${OS_NAME}, use build.bat for Windows"
endif

build-sdk-linux:
	@mkdir -p ./bin/sdk
	@echo "[nhp-frp] Building Linux SDK (nhp-agent.so)..."
	@cd $(OPENNHP_DIR)/nhp && go mod tidy
	@cd $(OPENNHP_DIR)/endpoints && go mod tidy
	@cd $(OPENNHP_DIR)/endpoints && \
		go build -a -trimpath -buildmode=c-shared -ldflags="-w -s" -v \
		-o ../../../bin/sdk/nhp-agent.so ./agent/main/main.go ./agent/main/export.go
	@echo "[nhp-frp] Linux SDK built successfully!"
	@cd $(OPENNHP_DIR)/nhp && git restore go.mod go.sum 2>/dev/null || git checkout go.mod go.sum 2>/dev/null || true
	@cd $(OPENNHP_DIR)/endpoints && git restore go.mod go.sum 2>/dev/null || git checkout go.mod go.sum 2>/dev/null || true
	@cd $(OPENNHP_DIR) && git reset --hard HEAD 2>/dev/null || true

build-sdk-macos:
	@mkdir -p ./bin/sdk
	@echo "[nhp-frp] Building macOS SDK (nhp-agent.dylib)..."
	@cd $(OPENNHP_DIR)/nhp && go mod tidy
	@cd $(OPENNHP_DIR)/endpoints && go mod tidy
	@cd $(OPENNHP_DIR)/endpoints && \
		GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 \
		go build -a -trimpath -buildmode=c-shared -ldflags="-w -s" -v \
		-o ../../../bin/sdk/nhp-agent.dylib ./agent/main/main.go ./agent/main/export.go
	@echo "[nhp-frp] macOS SDK built successfully!"
	@cd $(OPENNHP_DIR)/nhp && git restore go.mod go.sum 2>/dev/null || git checkout go.mod go.sum 2>/dev/null || true
	@cd $(OPENNHP_DIR)/endpoints && git restore go.mod go.sum 2>/dev/null || git checkout go.mod go.sum 2>/dev/null || true
	@cd $(OPENNHP_DIR) && git reset --hard HEAD 2>/dev/null || true

# Clean SDK binaries
clean-sdk:
	@echo "[nhp-frp] Cleaning SDK binaries..."
	rm -f bin/sdk/nhp-agent.so bin/sdk/nhp-agent.dylib bin/sdk/nhp-agent.dll bin/sdk/nhp-agent.h

frpc: build-sdk
	go build -trimpath -ldflags "$(LDFLAGS)" -o bin/nhp-frpc ./cmd/frpc
ifeq ($(OS_NAME), darwin)
	install_name_tool -change nhp-agent.dylib ./bin/sdk/nhp-agent.dylib ./bin/nhp-frpc
endif

clean:
	rm -f ./bin/nhp-frpc
	rm -f ./bin/nhp-frps
