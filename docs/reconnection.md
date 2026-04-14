# FRP Client Reconnection Behavior

This document describes the full reconnection and failure recovery behavior of the QURL reverse proxy client (`qurl-frpc`) and the desktop app wrapper.

## Architecture Overview

Reconnection is handled at three layers:

1. **FRP library (built-in)** — Detects connection drops and re-establishes the control connection to the FRP server, re-registering all tunnel proxies.
2. **QURL Go wrapper** — Configures FRP for resilience: never exits on login failure, tunes keepalive for faster dead-server detection.
3. **Desktop app (Electron)** — Monitors the `qurl-frpc` process and auto-restarts it with exponential backoff if it crashes.

## Layer 1: FRP Built-in Reconnection (v0.67)

FRP v0.67 has a robust two-layer reconnection system:

### Initial Login (`loopLoginUntilSuccess`)
- On startup, attempts to log in to the FRP server.
- On failure, retries with exponential backoff: 1s → 2s → 4s → ... → 10s (capped).
- With `LoginFailExit=false` (our default), retries **indefinitely**.

### Connection Recovery (`keepControllerWorking`)
- After successful login, a background goroutine monitors the control connection.
- When the connection drops (server restart, network failure), triggers `loopLoginUntilSuccess` again.
- Uses **fast-retry mode** for the first 3 attempts within a 1-minute window: 200ms delay with 50% jitter.
- After fast-retry exhaustion, falls back to exponential backoff: 1s → 2s → 4s → ... → 20s (capped).
- All delays include jitter to prevent thundering-herd reconnection storms.

### Failure Detection
- **TCPMux (default: enabled)** — Uses yamux keepalive probes every 30 seconds. Dead connections are detected within ~60–90 seconds.
- **Application heartbeat** — Disabled when TCPMux is on (redundant). Sends Ping/Pong at 30s intervals when TCPMux is off.
- **TCP keepalive** — Configured at 60 seconds (via `server.keepalive`), providing a lower-layer backup.

### Tunnel Re-registration
When the client reconnects, it automatically re-registers all configured proxy routes (HTTP subdomains, TCP ports) with the server. No manual intervention is required — tunnel state is rebuilt from the local configuration file.

## Layer 2: QURL Configuration Defaults

The QURL wrapper applies these defaults to make FRP resilient out of the box:

| Setting | FRP Default | QURL Default | Why |
|---------|------------|--------------|-----|
| `LoginFailExit` | `true` | **`false`** | Prevents process exit on initial login failure. Critical for desktop app — without this, the process dies after 2.5s if the server is unreachable at startup. |
| `DialServerKeepAlive` | `7200s (2hr)` | **`60s`** | Detects dead TCP connections in ~2 minutes instead of ~4 hours. |
| `DialServerTimeout` | `10s` | `10s` | No change — 10s is reasonable for initial connection. |
| Signal handling | KCP/QUIC only | **All protocols** | Graceful shutdown with 500ms drain for TCP, KCP, and QUIC. |

### Configuration Reference

These settings can be customized in `qurl-proxy.yaml`:

```yaml
server:
  addr: proxy.layerv.ai
  port: 7000
  token: your-token

  # Reconnection tuning (all optional — defaults shown)
  keepalive: 60          # TCP keepalive probe interval in seconds
  dial_timeout: 10       # Server connection timeout in seconds
  login_fail_exit: false # Set true to exit on initial login failure
```

### Heartbeat Enrichment

The QURL API heartbeat (every 30 seconds) now includes a `status` field derived from the FRP admin API:
- `"connected"` — At least one proxy is `running`
- `"reconnecting"` — Proxies exist but none are `running` yet
- `"starting"` — Admin API not yet reachable (initial startup)

## Layer 3: Desktop App Auto-Restart

The Electron desktop app wraps `qurl-frpc` as a detached child process and adds its own recovery layer:

### Auto-Restart Behavior
- When the `qurl-frpc` process exits **unexpectedly** (crash, OOM, fatal error), the desktop app automatically restarts it.
- Uses exponential backoff: 2s → 4s → 8s → 16s → 32s → 60s (capped).
- Gives up after **10 consecutive failures** to avoid infinite spinning (e.g., missing binary, broken config).
- Resets the attempt counter on successful restart.

### Intentional Stop
- When the user clicks "Stop Tunnel", the stop is marked as intentional and auto-restart is suppressed.
- This distinction ensures the user's intent is respected.

### Connection State Detection
The desktop app uses the FRP admin API (`http://127.0.0.1:7400/api/status`) to detect the actual tunnel connection state, not just whether the process is alive:

| Admin API Response | Displayed State |
|---|---|
| Any proxy status `"running"` | **Connected** (green) |
| Proxies exist, none `"running"` | **Reconnecting** (yellow, pulsing) |
| Admin API unreachable, process alive | **Reconnecting** (yellow, pulsing) |
| Process not running, no restart pending | **Disconnected** (red) |
| Restart timer active | **Reconnecting** (yellow, pulsing) |

State changes are pushed to the renderer via IPC events (`sidecar:stateChange`) for instant UI updates, with 5-second polling as a safety net.

## Failure Scenarios

### Server Restart
1. Server process stops → client's yamux keepalive detects within ~60s
2. FRP triggers `keepControllerWorking` → fast-retry 3x at 200ms
3. If server not yet back: exponential backoff up to 20s
4. Server comes back → client re-logs in → all proxies re-registered
5. **Total downtime: ~60s detection + ~1–20s reconnection**

### Network Blip (< 90s)
1. Yamux session may survive if the blip is short enough
2. If it doesn't: same flow as server restart
3. **Total downtime: duration of blip + ~1–20s reconnection**

### Process Crash
1. `qurl-frpc` process exits with non-zero code
2. Desktop app detects exit immediately
3. Auto-restart kicks in after 2s delay
4. **Total downtime: ~2.5s (startup grace period)**

### Server Migration (DNS Change)
1. Client connects to old server IP via cached DNS
2. Old server dies → yamux detects in ~60s → reconnection loop starts
3. DNS TTL expires → new connection resolves to new server IP
4. Client connects to new server → proxies re-registered
5. **Total downtime: ~60s + DNS TTL**

### Binary Missing or Config Broken
1. Auto-restart attempts to start `qurl-frpc`
2. Start fails immediately (missing binary, parse error)
3. Retries with exponential backoff up to 10 times
4. After 10 failures: gives up, shows "Disconnected"
5. User must fix the underlying issue and manually restart

## NHP Knock Interaction

The NHP knock loop runs independently from FRP:
- Sends encrypted knock packets to the NHP server on a continuous loop
- Each successful knock opens the firewall for an `OpenTime` window (typically minutes)
- The knock loop continues regardless of FRP connection state
- When FRP reconnects, it does so within the existing open firewall window — **no new knock is required**
- If the knock itself fails, it retries every 10 seconds
