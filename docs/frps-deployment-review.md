# Updated Deployment Review

## NEW Critical Issue: `*.qurl.site` routing conflict

This is the biggest blocker I found. After tracing the full resolution flow through qurl-service and the infrastructure terraform, the deployment plan as written **will not work** because of a routing conflict with the existing production infrastructure.

**Current production state:**
- `*.qurl.site` DNS (Route 53) → **NLB** → AC instances → **Traefik + qurl-router plugin** → proxies to resource's `target_url`
- This handles public URL resources perfectly (e.g., `target_url = https://example.com/app`)

**What happens with FRP-tunneled resources under this architecture:**

1. Desktop app calls `qurl-frpc add` → creates QURL API resource with `target_url = http://127.0.0.1:9876` (local file server)
2. Resource gets `resource_id = r_abc123`, FRP route subdomain = `r_abc123`
3. Desktop app creates a QURL with `target_url = https://r_abc123.qurl.site/token/file.pdf`
4. User clicks `qurl.link/at_xxx` → SPA → NHP server resolves → knock → redirects to `https://r_abc123.qurl.site/token/file.pdf`
5. Browser hits `r_abc123.qurl.site` → DNS resolves to **AC NLB** (not the FRP server!)
6. AC Traefik's qurl-router calls `GET /internal/v1/resource/r_abc123/target`
7. API returns `target_url = http://127.0.0.1:9876` ← the AC's localhost, not the user's machine
8. **Request fails** — qurl-router proxies to AC's own port 9876 which has nothing listening

The deployment plan assumes `*.qurl.site` → FRP server, but that DNS record already points to the AC NLB. Changing it would break all existing public URL resources.

**Three options to resolve this:**

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A** | Separate domain for FRP tunnels (e.g., `*.tunnel.qurl.site`) | No changes to existing infra; clean separation | Code changes needed in desktop app + Go config; new DNS record + TLS cert |
| **B** | Co-locate frps on AC instances; update qurl-router to detect tunneled resources and route to local frps | Single domain; cleanest long-term | Requires qurl-router plugin update + qurl-service API change to return routing hint |
| **C** | Run frps on separate server; update `*.qurl.site` DNS to a load balancer that splits traffic | One domain, separate infra | Complex routing split; risk of breaking existing resources |

I'd recommend **Option A** for MVP — it's the fastest path to testing end-to-end with minimal blast radius:

1. Add DNS: `*.tunnel.qurl.site` → FRP server IP
2. TLS cert for `*.tunnel.qurl.site` (via the existing ACME Lambda with Route 53 DNS challenge)
3. Update desktop app `getTunnelTargetUrl()` and Go config default `PublicDomain` to `tunnel.qurl.site`
4. Deploy frps + Caddy/Traefik on a new server
5. Existing `*.qurl.site` → AC routing is completely untouched

---

## QURL Resolution Flow (answered from qurl-service code)

The resolution is **not a simple 302 redirect**. Here's the actual flow:

```
User clicks qurl.link/at_abc123
  → qurl.link serves a static SPA
  → SPA extracts token from URL hash fragment
  → SPA redirects to NHP server: resolve.qurl.link/plugins/qurl?token=at_...
  → NHP server calls POST /internal/v1/resolve on qurl-service API
      → Validates token, creates session, returns {target_url, qurl_site_url, jwt_secret}
  → NHP server triggers NHP knock (opens firewall for user's IP)
  → NHP server 302 redirects to qurl_site_url (e.g., https://r_abc.qurl.site)
  → Traefik qurl-router on AC extracts resource_id from subdomain
  → Calls GET /internal/v1/resource/:id/target → gets target_url
  → Reverse-proxies request to target_url
```

The NHP session is tracked via `OPENNHP_` cookies on the `qurl.site` domain. The `hqdatamiddleware` Traefik plugin handles session/cookie validation for subsequent requests.

---

## DNS & TLS Setup (from nhp terraform)

- **DNS**: AWS Route 53, zone ID `Z06942509AYXSB91X7CD`
- **TLS certs**: Let's Encrypt with **DNS-01 challenge via Route 53** (managed by a Lambda function in `nhp/terraform/modules/acme-cert/`)
- **Cert storage**: AWS Secrets Manager (KMS-encrypted)

This confirms the deployment doc's Traefik `tlsChallenge` is wrong — the existing infra already uses DNS-01 via Route 53, not TLS-ALPN-01.

---

## Revised Issue Summary

| # | Priority | Issue | Impact |
|---|----------|-------|--------|
| 1 | **P0** | `*.qurl.site` routing conflict — DNS points to AC NLB, not FRP server | Tunneled resources unreachable; entire deployment won't work |
| 2 | **P0** | Traefik TLS: `tlsChallenge` can't issue wildcard certs | All `*.qurl.site` HTTPS fails; use DNS-01 (Route 53) |
| 3 | **P0** | `deploy/frps.toml`: `vhostHTTPPort = 443` conflicts with Traefik | Port conflict; should be 80 (Docker) or 8080 (bare metal) |
| 4 | **P0** | `Dockerfile.ac_frps` CMD broken | frps blocks, Traefik never starts |
| 5 | **P0** | Docker Compose missing port mappings for nhp-ac | No external traffic reaches the container |
| 6 | **P0** | Docker build requires missing `opennhp-base` image | `docker build` fails immediately |
| 7 | **P1** | Traefik v3 syntax vs v2 syntax in routing rules | HostRegexp rule won't match |
| 8 | **P1** | Desktop app defaults server to `127.0.0.1` | Users connect to localhost instead of production server |
| 9 | **P2** | `qurl-files` route created without auth token lacks resource_id subdomain | Inconsistent URL pattern |

---

## Questions for you

Before I start fixing things:

1. **Do you want to go with Option A (separate `tunnel.qurl.site` domain)?** This is the fastest path to testing. Option B is cleaner long-term but requires qurl-router plugin changes.

2. **Bare metal (Caddy) or Docker for the FRP server?** Given the Docker issues (broken CMD, missing base image, NHP dependencies), bare metal + Caddy is significantly simpler for the MVP. You just need the `qurl-frps` binary + Caddy + a systemd service.

3. **Which server are you planning to deploy on?** Need to know for firewall rules and whether Route 53 DNS records need updating.

4. **Should I also update the desktop app defaults** (server addr, token, public domain) in the same pass, or do you want to handle that separately with env vars?
