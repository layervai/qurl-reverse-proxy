# QURL Reverse Proxy Server Deployment Guide

This guide covers deploying `qurl-frps` so the desktop app can share files and services through QURL links end-to-end.

## Architecture Overview

```
Browser -> qurl.link (QURL resolution) -> *.qurl.site (FRP server) -> tunnel -> desktop app -> local service/file
```

- **qurl-frps** runs on a public server, terminates TLS via Traefik, and routes `*.qurl.site` subdomains to the correct tunnel
- **qurl-frpc** (desktop app sidecar) connects to qurl-frps and registers routes
- When a QURL is resolved, the browser is proxied through `*.qurl.site` to the local service

## Prerequisites

- A public server (EC2, GCP VM, DigitalOcean droplet, etc.)
- A domain with wildcard DNS support (we use `qurl.site`)
- Docker + Docker Compose (for the containerized approach) OR Go 1.25+ (for bare metal)
- TLS certificates (Let's Encrypt via Traefik, or your own)

## DNS Records

Set up these DNS records pointing to your server's public IP:

| Type | Name | Value | Purpose |
|------|------|-------|---------|
| A | `proxy.layerv.ai` | `<server-ip>` | FRP server hostname |
| A | `*.qurl.site` | `<server-ip>` | Wildcard for subdomain routing |

The wildcard record is critical — every tunneled service gets a unique subdomain like `f0db8dd2-qurl-files.qurl.site`.

---

## Option A: Docker Compose (Recommended)

This deploys the full stack: qurl-frps + Traefik (TLS) + NHP Access Controller.

### 1. Build

```bash
cd qurl-reverse-proxy

# Build the server Docker image
docker build -f docker/Dockerfile.ac_frps -t qurl-frps .
```

### 2. Configure

Create the config directory and files:

```bash
mkdir -p docker/nhp-ac/etc
mkdir -p docker/nhp-ac/traefik/etc
mkdir -p docker/nhp-ac/logs
```

**Server config** (`docker/nhp-ac/etc/frps.toml`):

```toml
bindPort = 7000
vhostHTTPPort = 80
subDomainHost = "qurl.site"

log.to = "/nhp-ac/logs/qurl-frps.log"
log.level = "info"
log.maxDays = 7

auth.method = "token"
auth.token = "{{ .Envs.FRPS_AUTH_TOKEN }}"

webServer.addr = "127.0.0.1"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "{{ .Envs.FRPS_ADMIN_PASSWORD }}"
```

Note: `vhostHTTPPort = 80` because Traefik handles TLS on 443 and forwards plain HTTP to frps.

**Traefik config** (`docker/nhp-ac/traefik/etc/traefik.toml`):

```toml
[entryPoints]
  [entryPoints.websecure]
    address = ":443"
  [entryPoints.web]
    address = ":80"
    [entryPoints.web.http.redirections.entryPoint]
      to = "websecure"
      scheme = "https"

[certificatesResolvers.letsencrypt.acme]
  email = "admin@layerv.ai"
  storage = "/nhp-ac/traefik/acme.json"
  [certificatesResolvers.letsencrypt.acme.tlsChallenge]

[providers.file]
  filename = "/opt/traefik/provider.toml"

[log]
  level = "INFO"
```

**Traefik provider** (`docker/nhp-ac/traefik/etc/provider.toml`):

```toml
[http.routers.frps]
  entryPoints = ["websecure"]
  rule = "HostRegexp(`{subdomain:[a-z0-9-]+}.qurl.site`)"
  service = "frps"
  [http.routers.frps.tls]
    certResolver = "letsencrypt"
    [[http.routers.frps.tls.domains]]
      main = "qurl.site"
      sans = ["*.qurl.site"]

[http.services.frps.loadBalancer]
  [[http.services.frps.loadBalancer.servers]]
    url = "http://127.0.0.1:80"
```

### 3. Set environment variables

```bash
# Generate a strong auth token for FRP client connections
export FRPS_AUTH_TOKEN=$(openssl rand -hex 32)
export FRPS_ADMIN_PASSWORD=$(openssl rand -hex 16)

# Save these somewhere secure — clients need FRPS_AUTH_TOKEN
echo "Auth token: $FRPS_AUTH_TOKEN"
echo "Admin password: $FRPS_ADMIN_PASSWORD"
```

### 4. Start

```bash
docker-compose -f docker/docker-compose.yaml up -d nhp-ac
```

### 5. Verify

```bash
# Check frps is listening
nc -z <server-ip> 7000 && echo "FRP port open"

# Check HTTPS is working
curl -I https://test.qurl.site  # Should return FRP 404 (no proxy registered yet)

# Check admin dashboard (from server)
curl -u admin:$FRPS_ADMIN_PASSWORD http://127.0.0.1:7500/api/proxy/http
```

---

## Option B: Bare Metal (Simpler)

Skip Docker and run qurl-frps directly with a reverse proxy (Caddy, nginx, etc.) for TLS.

### 1. Build

```bash
cd qurl-reverse-proxy
make frps
# Binary: bin/qurl-frps
```

### 2. Deploy binary

```bash
scp bin/qurl-frps user@server:/opt/qurl/
scp deploy/frps.toml user@server:/opt/qurl/etc/frps.toml
```

### 3. Configure

Edit `/opt/qurl/etc/frps.toml` on the server:

```toml
bindPort = 7000
vhostHTTPPort = 8080
subDomainHost = "qurl.site"

log.to = "/var/log/qurl/qurl-frps.log"
log.level = "info"
log.maxDays = 7

auth.method = "token"
auth.token = "your-secure-token-here"

webServer.addr = "127.0.0.1"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "your-admin-password"
```

### 4. TLS with Caddy (simplest option)

Install Caddy on the server and create `/etc/caddy/Caddyfile`:

```
*.qurl.site {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }
    reverse_proxy localhost:8080
}
```

Caddy auto-provisions wildcard TLS certs via DNS challenge. Start Caddy:

```bash
sudo systemctl enable --now caddy
```

### 5. Start qurl-frps

```bash
# As a systemd service
sudo tee /etc/systemd/system/qurl-frps.service << 'EOF'
[Unit]
Description=QURL FRP Server
After=network.target

[Service]
ExecStart=/opt/qurl/qurl-frps -c /opt/qurl/etc/frps.toml
Environment=FRPS_AUTH_TOKEN=your-secure-token-here
Environment=FRPS_ADMIN_PASSWORD=your-admin-password
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now qurl-frps
```

### 6. Open firewall ports

```bash
# FRP client connections
sudo ufw allow 7000/tcp

# HTTPS (Caddy)
sudo ufw allow 443/tcp
sudo ufw allow 80/tcp
```

---

## Desktop Client Configuration

Once the server is deployed, update the desktop app's default sidecar config.

### Update `desktop/src/main/sidecar.ts`

Change the `writeDefaultConfig()` method's defaults:

```typescript
const serverAddr = process.env.QURL_TUNNEL_ADDR || 'proxy.layerv.ai';
const serverToken = process.env.QURL_TUNNEL_TOKEN || '<your-FRPS_AUTH_TOKEN>';
```

### Environment variables for the desktop app

| Variable | Default | Purpose |
|----------|---------|---------|
| `QURL_TUNNEL_ADDR` | `proxy.layerv.ai` | FRP server hostname |
| `QURL_TUNNEL_TOKEN` | (set in code) | FRP auth token |
| `QURL_TUNNEL_URL` | `https://{subdomain}.qurl.site` | Public URL template (only override for local dev) |
| `QURL_ENV` | `production` | `staging` for staging API/Auth0 |

### Update existing client configs

Users with existing configs at `~/.config/qurl/qurl-proxy.yaml` need to update:

```yaml
server:
  addr: proxy.layerv.ai    # was: acdemo.opennhp.org or 127.0.0.1
  port: 7000
  token: <FRPS_AUTH_TOKEN>  # was: opennhp-frp or qurl-dev-token
```

---

## Verification Checklist

After deploying, verify the full end-to-end flow:

1. **Server health**: `nc -z proxy.layerv.ai 7000` (FRP port reachable)
2. **TLS working**: `curl -I https://test.qurl.site` (returns FRP 404, not TLS error)
3. **Desktop app connects**: Start tunnel in Connections tab, should show "connected"
4. **Proxy registers**: `curl -u admin:<pass> http://server:7500/api/proxy/http` shows proxies with `status: online`
5. **File share works**: Share a file -> QURL created -> open link in browser -> file downloads
6. **Service share works**: Add a local service, start tunnel, share -> QURL resolves to the service

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Target did not respond in time" | `*.qurl.site` DNS not set up | Add wildcard A record |
| Tunnel connects then disconnects | Auth token mismatch | Check `server.token` matches `FRPS_AUTH_TOKEN` |
| "address already in use" on port 7400 | Stale frpc process | `pkill -f qurl-frpc` and retry |
| Proxy shows "offline" on server | FRP reload bug drops proxies | App now does full restart instead of reload |
| FRP 404 page in browser | Subdomain not matching | Check `subDomainHost` matches the domain in the URL |
| Files accessible after revoke | Share files not cleaned up | App now cleans files on revoke and startup |

## Security Notes

- `FRPS_AUTH_TOKEN` is a shared secret between all clients and the server. Keep it in a secrets manager.
- The admin dashboard (port 7500) should NOT be exposed publicly. Only bind to 127.0.0.1.
- In production, enable NHP (network hiding) so port 7000 is invisible until a cryptographic knock is received.
- File shares are cleaned up on revoke and on app startup for revoked/expired resources.
