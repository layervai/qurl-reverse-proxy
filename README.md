# NHP-FRP

[English](README.md) | [中文](README_zh.md)

NHP-FRP integrates [OpenNHP](https://github.com/OpenNHP/opennhp) (Network infrastructure Hiding Protocol) with [frp](https://github.com/fatedier/frp) (fast reverse proxy) to provide **zero-trust network access** for reverse proxy tunnels.

## What is NHP-FRP?

Standard frp exposes server ports to the public internet, making them visible to port scanners and vulnerable to attacks. NHP-FRP solves this by adding an NHP layer that **hides server ports by default** and only opens them to authenticated, authorized clients.

**How it works:**

1. The NHP Agent (built into `nhp-frpc`) sends a cryptographic "knock" to the NHP server before connecting
2. The NHP server verifies the client's identity and opens the frp server port **only for that specific client IP**
3. The frp tunnel is established through the now-open port
4. The port is hidden again after the session, invisible to all other traffic

This turns frp into a **zero-trust reverse proxy** -- services are completely invisible on the network until a verified client needs access.

## Architecture

### The Problem: Standard frp

With standard frp, the server port (e.g. 7000) is always open and visible to anyone on the internet:

```
                         Public Internet
  ┌──────────┐                                    ┌──────────────────────────┐
  │  frpc    │──── frp tunnel (TCP:7000) ────────>│  frps (:7000 OPEN)      │
  │  client  │                                    │         │                │
  └──────────┘                                    │         v                │
                                                  │   Backend Services      │
  ┌──────────┐                                    │   ┌─────────────────┐   │
  │ Attacker │──── port scan / exploit ──────────>│   │ Web App :8080   │   │
  │          │     :7000 is visible!              │   │ SSH     :22     │   │
  └──────────┘                                    │   │ DB      :3306   │   │
                                                  │   └─────────────────┘   │
                                                  └──────────────────────────┘
                                                        Private Network
```

**Problem:** Port 7000 is exposed to the entire internet. Attackers can discover it via port scanning, then attempt brute-force attacks, exploit vulnerabilities, or launch DDoS attacks.

### The Solution: NHP-FRP

NHP-FRP hides all server ports. They only open for verified clients, for a limited time:

```
                         Public Internet
                                                  ┌──────────────────────────┐
                  1. NHP Knock (UDP)              │                          │
  ┌──────────┐ ─────────────────────────────────> │  NHP Server (nhp-door)   │
  │ nhp-frpc │                                    │    │ 2. Verify identity  │
  │  client  │         3. Port opened             │    │    Open firewall    │
  │  (with   │            (for this IP only)      │    v                     │
  │   NHP    │                                    │  Firewall                │
  │  Agent)  │ ── 4. frp tunnel (TCP:7000) ─────> │  [allow client IP:7000] │
  └──────────┘                                    │    │                     │
                                                  │    v                     │
                                                  │  nhp-frps (:7000)       │
  ┌──────────┐                                    │    │                     │
  │ Attacker │──── port scan ─────────── X ──────>│    v                     │
  │          │     :7000 is INVISIBLE!            │  Backend Services        │
  └──────────┘     (all ports closed)             │  ┌─────────────────┐    │
                                                  │  │ Web App :8080   │    │
                                                  │  │ SSH     :22     │    │
                                                  │  │ DB      :3306   │    │
                                                  │  └─────────────────┘    │
                                                  └──────────────────────────┘
                                                        Private Network
```

**Step-by-step flow:**

| Step | Action | Detail |
|------|--------|--------|
| 1 | **NHP Knock** | `nhp-frpc` sends an encrypted UDP knock packet to the NHP server |
| 2 | **Verify & Open** | NHP server verifies the client's cryptographic identity and instructs the firewall to open port 7000 **only for this client's IP** |
| 3 | **Port Opened** | The firewall now allows traffic from the client IP to port 7000. All other IPs still see the port as closed |
| 4 | **FRP Tunnel** | `nhp-frpc` establishes the frp tunnel through the now-accessible port |
| 5 | **Service Access** | Traffic flows through the frp tunnel to backend services in the private network |

**Result:** The server has **zero exposed ports** on the public internet. Even if an attacker knows the server's IP address, port scans return nothing. Services are only reachable by clients who can prove their identity through NHP's cryptographic knock.

### Components

| Binary | Description |
|--------|-------------|
| `nhp-frpc` | frp client with built-in NHP Agent -- performs NHP knock before connecting |
| `nhp-frps` | frp server (thin wrapper, future NHP integration planned) |
| `nhp-agent.dll/.so/.dylib` | NHP SDK shared library used by nhp-frpc |

## Project Structure

```
nhp-frp/
  cmd/
    frpc/           # nhp-frpc entry point (NHP Agent + frp client)
    frps/           # nhp-frps entry point (frp server wrapper)
  conf/             # Example configuration files
  hack/             # Build helper scripts
  third_party/
    opennhp/        # OpenNHP submodule (NHP SDK source)
  bin/              # Build output
    nhp-frpc(.exe)
    nhp-frps(.exe)
    sdk/            # NHP SDK shared libraries
  build.bat         # Windows build script
  Makefile          # Linux/macOS build script
```

This project is a **thin wrapper** around upstream frp -- it imports [frp v0.67.0](https://github.com/fatedier/frp) as a Go module dependency rather than forking the source. Only NHP-specific code lives in this repository, making upstream upgrades simple (change the version in `go.mod`).

## Building

### Prerequisites

- **Go** 1.23+
- **GCC** (for building the NHP SDK shared library via CGO)
  - Linux: `apt install gcc` or equivalent
  - macOS: Xcode Command Line Tools
  - Windows: [MSYS2](https://www.msys2.org/) with `mingw-w64-x86_64-gcc`

### Linux / macOS

```bash
# Build everything (nhp-frps + nhp-frpc with SDK)
make

# Build individual targets
make frps
make frpc        # includes SDK build
make build-sdk   # SDK only
```

### Windows

```cmd
:: Build everything
build.bat

:: Build individual targets
build.bat frps
build.bat frpc        &:: includes SDK build
build.bat build-sdk   &:: SDK only

:: Other commands
build.bat clean
build.bat help
```

> **Note (Windows):** The SDK build requires MSYS2 MinGW-w64. The build script auto-detects MSYS2 at `C:\Program Files\msys2` or `C:\msys64`. You may need to add Windows Defender exclusions for the `bin\sdk\` directory and your temp folder if the DLL build is blocked.

## Configuration

NHP-FRP uses the same configuration format as frp. Place config files alongside the binary or specify with `-c`.

**frps (server):** `frps.toml`
```toml
bindPort = 7000
```

**frpc (client):** `frpc.toml`
```toml
serverAddr = "127.0.0.1"
serverPort = 7000

[[proxies]]
name = "test-tcp"
type = "tcp"
localIP = "127.0.0.1"
localPort = 22
remotePort = 6000
```

See [conf/](conf/) for full example configurations. For frp configuration details, refer to the [frp documentation](https://github.com/fatedier/frp#configuration).

The NHP Agent is configured separately -- it reads its configuration from the same directory as the `nhp-frpc` binary. See [OpenNHP documentation](https://github.com/OpenNHP/opennhp) for NHP configuration details.

## Running

```bash
# Start the server
./bin/nhp-frps -c ./conf/frps.toml

# Start the client (NHP Agent starts automatically)
./bin/nhp-frpc -c ./conf/frpc.toml
```

When `nhp-frpc` starts, it first initializes the NHP Agent which performs the cryptographic knock sequence. Once the NHP handshake succeeds, the frp client connects to the server normally.

## Related Projects

- [frp](https://github.com/fatedier/frp) -- The upstream fast reverse proxy
- [OpenNHP](https://github.com/OpenNHP/opennhp) -- Network Hiding Protocol implementation

## License

Apache License 2.0 -- see [LICENSE](LICENSE) for details.

This project builds upon [frp](https://github.com/fatedier/frp) by fatedier (Apache 2.0) and [OpenNHP](https://github.com/OpenNHP/opennhp) by the OpenNHP team.
