export PATH := $(PATH):`go env GOPATH`/bin
export GO111MODULE=on
OS_NAME = $(shell uname -s | tr A-Z a-z)
# OpenNHP submodule directory
OPENNHP_DIR = third_party/opennhp

# Version info injected at build time
BASE_VERSION ?= $(shell git describe --tags --abbrev=0 2>/dev/null || echo "0.1.0")
BUILD_TIMESTAMP ?= $(shell date -u '+%y%m%d%H%M%S')
VERSION ?= $(BASE_VERSION).$(BUILD_TIMESTAMP)
GIT_COMMIT ?= $(shell git rev-parse HEAD 2>/dev/null || echo "unknown")
GIT_COMMIT_TIME ?= $(shell git log -1 --format='%ci' 2>/dev/null || echo "unknown")
BUILD_DATE ?= $(shell date -u '+%Y-%m-%d %H:%M:%S')
NHP_VERSION ?= $(shell cd $(OPENNHP_DIR) && git describe --tags --always 2>/dev/null || echo "unknown")
FRP_VERSION ?= $(shell grep 'github.com/fatedier/frp ' go.mod | awk '{print $$2}')
VERSION_PKG = github.com/layervai/qurl-reverse-proxy/pkg/version
LDFLAGS := -s -w -X '$(VERSION_PKG).Version=$(VERSION)' -X '$(VERSION_PKG).GitCommit=$(GIT_COMMIT)' -X '$(VERSION_PKG).BuildDate=$(BUILD_DATE)' -X '$(VERSION_PKG).NHPVersion=$(NHP_VERSION)'

# ANSI color codes
BLUE := \033[34m
GREEN := \033[32m
RESET := \033[0m

all: print-version env build

build: frps frpc

print-version:
	@printf "$(BLUE)[qurl-proxy] Start building...$(RESET)\n"
	@printf "$(BLUE)Version:     $(VERSION) (OpenNHP: $(NHP_VERSION), FRP: $(FRP_VERSION))$(RESET)\n"
	@printf "$(BLUE)Commit id:   $(GIT_COMMIT)$(RESET)\n"
	@printf "$(BLUE)Commit time: $(GIT_COMMIT_TIME)$(RESET)\n"
	@printf "$(BLUE)Build time:  $(BUILD_DATE)$(RESET)\n"
	@echo ""

env:
	@go version

fmt:
	go fmt ./...

frps:
	@printf "$(BLUE)[qurl-proxy] Building qurl-frps ...$(RESET)\n"
	env CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -tags frps -o bin/qurl-frps ./cmd/frps
	@printf "$(GREEN)[qurl-proxy] qurl-frps built successfully! -> $(CURDIR)/bin/qurl-frps$(RESET)\n"

# Build OpenNHP SDK from submodule
build-sdk:
	@printf "$(BLUE)[qurl-proxy] Building OpenNHP SDK from submodule...$(RESET)\n"
ifeq ($(OS_NAME), linux)
	@$(MAKE) build-sdk-linux
else ifeq ($(OS_NAME), darwin)
	@$(MAKE) build-sdk-macos
else
	@printf "$(BLUE)[qurl-proxy] Skipping OpenNHP SDK build on ${OS_NAME}, use build.bat for Windows$(RESET)\n"
endif

build-sdk-linux:
	@mkdir -p ./bin/sdk
	@printf "$(BLUE)[qurl-proxy] Building OpenNHP Linux SDK (nhp-agent.so)...$(RESET)\n"
	@cd $(OPENNHP_DIR)/nhp && go mod tidy
	@cd $(OPENNHP_DIR)/endpoints && go mod tidy
	@cd $(OPENNHP_DIR)/endpoints && \
		go build -a -trimpath -buildmode=c-shared -ldflags="-w -s" -v \
		-o ../../../bin/sdk/nhp-agent.so ./agent/main/main.go ./agent/main/export.go
	@printf "$(GREEN)[qurl-proxy] OpenNHP Linux SDK built successfully! -> $(CURDIR)/bin/sdk/nhp-agent.so$(RESET)\n"
	@cd $(OPENNHP_DIR)/nhp && git restore go.mod go.sum 2>/dev/null || git checkout go.mod go.sum 2>/dev/null || true
	@cd $(OPENNHP_DIR)/endpoints && git restore go.mod go.sum 2>/dev/null || git checkout go.mod go.sum 2>/dev/null || true
	@cd $(OPENNHP_DIR) && git reset --hard HEAD 2>/dev/null || true

build-sdk-macos:
	@mkdir -p ./bin/sdk
	@printf "$(BLUE)[qurl-proxy] Building OpenNHP macOS SDK (nhp-agent.dylib)...$(RESET)\n"
	@cd $(OPENNHP_DIR)/nhp && go mod tidy
	@cd $(OPENNHP_DIR)/endpoints && go mod tidy
	@cd $(OPENNHP_DIR)/endpoints && \
		GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 \
		go build -a -trimpath -buildmode=c-shared -ldflags="-w -s" -v \
		-o ../../../bin/sdk/nhp-agent.dylib ./agent/main/main.go ./agent/main/export.go
	@printf "$(GREEN)[qurl-proxy] OpenNHP macOS SDK built successfully! -> $(CURDIR)/bin/sdk/nhp-agent.dylib$(RESET)\n"
	@cd $(OPENNHP_DIR)/nhp && git restore go.mod go.sum 2>/dev/null || git checkout go.mod go.sum 2>/dev/null || true
	@cd $(OPENNHP_DIR)/endpoints && git restore go.mod go.sum 2>/dev/null || git checkout go.mod go.sum 2>/dev/null || true
	@cd $(OPENNHP_DIR) && git reset --hard HEAD 2>/dev/null || true

# Clean SDK binaries
clean-sdk:
	@printf "$(BLUE)[qurl-proxy] Cleaning OpenNHP SDK binaries...$(RESET)\n"
	rm -f bin/sdk/nhp-agent.so bin/sdk/nhp-agent.dylib bin/sdk/nhp-agent.dll bin/sdk/nhp-agent.h

frpc: build-sdk
	@printf "$(BLUE)[qurl-proxy] Building qurl-frpc ...$(RESET)\n"
	CGO_ENABLED=1 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/qurl-frpc ./cmd/frpc
ifeq ($(OS_NAME), darwin)
	install_name_tool -change nhp-agent.dylib ./bin/sdk/nhp-agent.dylib ./bin/qurl-frpc
endif
	@printf "$(GREEN)[qurl-proxy] qurl-frpc built successfully! -> $(CURDIR)/bin/qurl-frpc$(RESET)\n"

test:
	go test -race -count=1 ./...

vet:
	go vet ./...

clean:
	rm -f ./bin/qurl-frpc
	rm -f ./bin/qurl-frps
