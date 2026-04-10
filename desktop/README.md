# QURL Desktop

Electron desktop app for managing tunnel services, file sharing, and QURLs.

## Development

```bash
# Install dependencies
npm install

# Start in development mode (with hot reload)
npm run dev

# Build for production
npm run build

# Run the built app
npm start
```

The app requires the `qurl-frpc` binary. In development it looks for `../bin/qurl-frpc` (built via `make frpc` from the project root).

## Architecture

```
src/
  main/          # Electron main process
    index.ts       Entry point, window/tray management
    ipc.ts         IPC handlers (auth, sidecar, shares, QURLs, updates)
    sidecar.ts     qurl-frpc process lifecycle
    updater.ts     Background update checker and applier
    auth.ts        Auth0 OAuth2 + API key authentication
    qurl-api.ts    QURL SDK wrapper
    file-server.ts HTTP file server for sharing
    tray.ts        System tray integration
  preload/       # Context bridge (main ↔ renderer)
    index.ts       Exposes typed window.qurl API
  renderer/      # React UI
    App.tsx        Shell with sidebar navigation + update banner
    pages/         Home, Resources, Connections, Settings, Login
    components/    Shared components
  types.d.ts     # TypeScript type definitions for the bridge API
```

## Auto-Update

The app checks for updates automatically every 4 hours (first check 30s after launch).

**Flow:**
1. Main process fetches `https://api.github.com/repos/layervai/qurl-reverse-proxy/releases/latest`
2. Compares the release tag against the current tunnel binary version
3. If newer: downloads the platform tarball silently to `~/.config/qurl/.update-staging/`
4. Pushes `update:ready` event to the renderer
5. Sidebar shows banner: "Updated to vX.Y.Z — Relaunch to apply"
6. On click: stops sidecar, swaps binary + SDK, restarts sidecar

Cache stored at `~/.config/qurl/update-check.json` with ETag support to minimize GitHub API calls.
