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

## Related Projects

- [frp](https://github.com/fatedier/frp) -- Upstream fast reverse proxy
- [OpenNHP](https://github.com/OpenNHP/opennhp) -- Network Hiding Protocol
- [QURL Service](https://github.com/layervai/qurl-service) -- Core QURL API

## License

Apache License 2.0 -- see [LICENSE](LICENSE) for details.

This project builds upon [frp](https://github.com/fatedier/frp) by fatedier (Apache 2.0) and [OpenNHP](https://github.com/OpenNHP/opennhp) by the OpenNHP team.
