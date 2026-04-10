import { ipcMain, dialog, app } from 'electron';
import { SidecarManager } from './sidecar';
import { FileServer } from './file-server';
import { getClient, clearClient, apiRequest } from './qurl-api';
import { updater } from './updater';
import * as auth from './auth';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Extract a readable error message from QURL SDK errors.
 * The SDK's QURLError may have `code`, `detail`, `message` in various formats.
 */
function formatApiError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    // QURLError has code, detail, message — but message may be "undefined (undefined): undefined"
    if (e.code && typeof e.code === 'string') {
      const detail = e.detail || e.message;
      const detailStr = detail && typeof detail === 'string' && !detail.includes('undefined') ? `: ${detail}` : '';
      // Map common codes to user-friendly messages
      switch (e.code) {
        case 'api_key_invalid':
        case 'invalid_token':
          return 'Authentication failed. Please sign out and sign in again, or use a valid API key.';
        case 'rate_limit_exceeded':
          return 'Rate limit exceeded. Please wait a moment and try again.';
        case 'quota_exceeded':
          return 'Quota exceeded. Upgrade your plan or wait for the quota to reset.';
        default:
          return `${(e.code as string).replace(/_/g, ' ')}${detailStr}`;
      }
    }
    if (e.message && typeof e.message === 'string' && !e.message.includes('undefined (undefined)')) {
      return e.message;
    }
  }
  const str = String(err);
  if (str.includes('undefined (undefined)')) return 'An unexpected API error occurred. Check your authentication.';
  return str;
}

interface ActiveShare {
  id: string;
  name: string;
  filePath: string;
  port: number;
  url: string;
  createdAt: number;
  expiresAt: number | null;
  qurlId?: string;
  resourceId?: string;
  tunnelName?: string;
}

export const sidecar = new SidecarManager();
const activeShares = new Map<string, ActiveShare>();

const SHARE_DIR = path.join(app.getPath('userData'), 'shares');
const SHARES_META_PATH = path.join(app.getPath('userData'), 'shares.json');
const DEFAULTS_PATH = path.join(app.getPath('userData'), 'qurl-defaults.json');
const DISABLED_SERVICES_PATH = path.join(app.getPath('userData'), 'disabled-services.json');

interface DisabledService {
  name: string;
  type: string;
  target: string;
  localPort: number;
  subdomain?: string;
}

function loadDisabledServices(): DisabledService[] {
  try {
    return JSON.parse(fs.readFileSync(DISABLED_SERVICES_PATH, 'utf-8'));
  } catch { return []; }
}

function saveDisabledServices(services: DisabledService[]): void {
  fs.writeFileSync(DISABLED_SERVICES_PATH, JSON.stringify(services, null, 2), 'utf-8');
}

const FILE_SERVER_PORT = 9876;

/**
 * Single persistent file server for all shares.
 * Serves the entire shares directory, surviving across share operations.
 */
let sharedFileServer: FileServer | null = null;

async function ensureFileServer(): Promise<{ port: number; url: string }> {
  // If server is already running, return it
  if (sharedFileServer && sharedFileServer.isServing()) {
    return { port: sharedFileServer.getPort(), url: `http://127.0.0.1:${sharedFileServer.getPort()}` };
  }

  const shareDir = ensureShareDir();
  sharedFileServer = new FileServer(FILE_SERVER_PORT);
  const result = await sharedFileServer.serve(shareDir);
  return result;
}

/**
 * Build the target URL for a tunneled subdomain (used in QURL API calls).
 * Always uses HTTPS qurl.site since the API requires HTTPS target URLs.
 */
function getTunnelTargetUrl(subdomain: string, pathSuffix?: string): string {
  const url = `https://${subdomain}.qurl.site`;
  return pathSuffix ? `${url}/${pathSuffix}` : url;
}

/**
 * Build the display URL for a tunneled subdomain (shown in UI).
 * In local dev, can be overridden via QURL_TUNNEL_URL for direct access.
 */
function getTunnelDisplayUrl(subdomain: string): string {
  const base = process.env.QURL_TUNNEL_URL;
  if (base) return base.replace('{subdomain}', subdomain);
  return `https://${subdomain}.qurl.site`;
}

function getFrpcPath(): string {
  return sidecar.getBinaryPath();
}

// Default QURL settings per resource type
const DEFAULT_QURL_DEFAULTS: QURLDefaults = {
  url: { expires_in: '24h', one_time_use: false },
  file: { expires_in: '1h', one_time_use: true },
  service: { expires_in: '7d', one_time_use: false, session_duration: '1h' },
};

function loadDefaults(): QURLDefaults {
  try {
    const data = fs.readFileSync(DEFAULTS_PATH, 'utf-8');
    return { ...DEFAULT_QURL_DEFAULTS, ...JSON.parse(data) };
  } catch {
    return { ...DEFAULT_QURL_DEFAULTS };
  }
}

function saveDefaults(defaults: Partial<QURLDefaults>): void {
  const current = loadDefaults();
  const merged = { ...current, ...defaults };
  fs.mkdirSync(path.dirname(DEFAULTS_PATH), { recursive: true });
  fs.writeFileSync(DEFAULTS_PATH, JSON.stringify(merged, null, 2));
}

/**
 * Detect if a URL points to a local service.
 */
function isLocalUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const hostname = u.hostname.toLowerCase();

    // Obvious local hostnames
    if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) {
      return true;
    }

    // Machine hostname
    if (hostname === os.hostname().toLowerCase()) {
      return true;
    }

    // Private IP ranges
    const parts = hostname.split('.').map(Number);
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Ensure the managed shares directory exists.
 */
function ensureShareDir(): string {
  fs.mkdirSync(SHARE_DIR, { recursive: true });
  return SHARE_DIR;
}

/**
 * Persist active shares metadata to disk so they survive app restarts.
 */
function persistShares(): void {
  try {
    const data = Array.from(activeShares.values());
    fs.writeFileSync(SHARES_META_PATH, JSON.stringify(data, null, 2));
  } catch { /* best effort */ }
}

/**
 * Load persisted shares from disk.
 */
function loadPersistedShares(): ActiveShare[] {
  try {
    if (!fs.existsSync(SHARES_META_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(SHARES_META_PATH, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

/**
 * Remove a specific token directory from the shares directory.
 */
function removeTokenDir(filePath: string): void {
  try {
    const tokenDir = path.dirname(filePath);
    if (fs.existsSync(tokenDir) && tokenDir.startsWith(SHARE_DIR)) {
      fs.rmSync(tokenDir, { recursive: true, force: true });
    }
  } catch { /* best effort */ }
}

/**
 * Remove orphaned token directories that aren't in activeShares.
 */
function cleanOrphanedShares(): void {
  try {
    if (!fs.existsSync(SHARE_DIR)) return;
    const knownTokens = new Set<string>();
    for (const share of activeShares.values()) {
      // Extract token dir name from filePath (e.g., .../shares/abc123/file.png → abc123)
      const tokenDir = path.basename(path.dirname(share.filePath));
      knownTokens.add(tokenDir);
    }
    const entries = fs.readdirSync(SHARE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !knownTokens.has(entry.name)) {
        fs.rmSync(path.join(SHARE_DIR, entry.name), { recursive: true, force: true });
      }
    }
  } catch { /* best effort */ }
}


export function setupIpcHandlers(): void {
  // Ensure the built-in qurl-files route exists on startup
  sidecar.ensureFilesRoute();

  // --- Auth ---

  ipcMain.handle('auth:signIn', async () => {
    try {
      const tokens = await auth.signIn();
      return { success: true, email: tokens.email, environment: tokens.environment };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  ipcMain.handle('auth:signInWithKey', async (_event, apiKey: string) => {
    try {
      const tokens = await auth.signInWithAPIKey(apiKey);
      return {
        success: true,
        environment: tokens.environment,
        apiKeyHint: tokens.apiKeyHint,
      };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  ipcMain.handle('auth:signOut', () => {
    auth.signOut();
    clearClient();
    return { success: true };
  });

  ipcMain.handle('auth:status', () => {
    const tokens = auth.getTokens();
    return {
      signedIn: tokens !== null,
      email: tokens?.email || null,
      environment: auth.getEnvironment(),
      apiKeyHint: tokens?.apiKeyHint || null,
    };
  });

  // --- Sidecar management ---

  ipcMain.handle('sidecar:start', async () => {
    try {
      await sidecar.start();
      return { success: true };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  ipcMain.handle('sidecar:stop', async () => {
    try {
      await sidecar.stop();
      return { success: true };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  ipcMain.handle('sidecar:status', () => {
    return sidecar.getStatus();
  });

  ipcMain.handle('sidecar:logs', () => {
    return { success: true, logs: sidecar.getLogs() };
  });

  // --- Tunnel/service management (uses qurl-frpc CLI) ---

  ipcMain.handle('tunnels:list', async () => {
    // Self-heal: ensure qurl-files route exists every time we list
    sidecar.ensureFilesRoute();
    try {
      const frpc = getFrpcPath();
      const { stdout } = await execFileAsync(frpc, ['list', '--json', '--config', sidecar.getConfigPath()]);
      const routes = JSON.parse(stdout) as Array<{
        Name: string;
        Type: string;
        LocalIP: string;
        LocalPort: number;
        Subdomain: string;
        TargetURL: string;
        ResourceID: string;
      }>;

      const tunnels: TunnelService[] = routes.map((r) => ({
        name: r.Name,
        type: (r.Type === 'frp_http' ? 'http' : r.Type === 'frp_tcp' ? 'tcp' : 'tcp') as TunnelService['type'],
        target: r.TargetURL || `${r.LocalIP}:${r.LocalPort}`,
        localPort: r.LocalPort,
        subdomain: r.Subdomain || undefined,
        resourceId: r.ResourceID || undefined,
        publicUrl: r.Subdomain ? getTunnelDisplayUrl(r.Subdomain) : undefined,
        status: sidecar.isRunning() ? 'connected' : 'disconnected',
        enabled: true,
      }));

      // Merge in disabled services
      const disabled = loadDisabledServices();
      for (const d of disabled) {
        tunnels.push({
          name: d.name,
          type: (d.type === 'frp_http' ? 'http' : d.type === 'frp_tcp' ? 'tcp' : 'tcp') as TunnelService['type'],
          target: d.target,
          localPort: d.localPort,
          subdomain: d.subdomain,
          status: 'disconnected',
          enabled: false,
        });
      }

      return tunnels;
    } catch {
      return [];
    }
  });

  ipcMain.handle('tunnels:add', async (_event, target: string, name: string) => {
    try {
      sidecar.ensureConfigExists();
      const frpc = getFrpcPath();
      const args = ['add', '--target', target, '--name', name, '--no-verify', '--config', sidecar.getConfigPath()];

      // Pass token if available for resource registration
      const tokens = auth.getTokens();
      if (tokens?.accessToken) {
        args.push('--token', tokens.accessToken);
      }

      await execFileAsync(frpc, args);

      // Hot-reload sidecar config if tunnel is running
      if (sidecar.isRunning()) {
        try { await sidecar.reload(); } catch { /* best effort */ }
      }

      const tunnel: TunnelService = {
        name,
        type: target.startsWith('http') ? 'http' : 'tcp',
        target,
        localPort: parseInt(new URL(target).port || '80', 10),
        status: 'disconnected',
        enabled: true,
      };

      return { success: true, tunnel };
    } catch (err) {
      const message = (err as Error & { stderr?: string }).stderr || (err as Error).message;
      return { success: false, error: message.trim() };
    }
  });

  ipcMain.handle('tunnels:remove', async (_event, name: string) => {
    if (name === 'qurl-files') {
      return { success: false, error: 'The File Sharing service cannot be removed — it is required for sharing local files through QURL.' };
    }
    try {
      const frpc = getFrpcPath();
      await execFileAsync(frpc, ['remove', name, '--config', sidecar.getConfigPath()]);

      // Hot-reload sidecar config if tunnel is running
      if (sidecar.isRunning()) {
        try { await sidecar.reload(); } catch { /* best effort */ }
      }

      return { success: true };
    } catch (err) {
      const message = (err as Error & { stderr?: string }).stderr || (err as Error).message;
      return { success: false, error: message.trim() };
    }
  });

  ipcMain.handle('tunnels:toggle', async (_event, name: string, enabled: boolean) => {
    try {
      const frpc = getFrpcPath();
      const configPath = sidecar.getConfigPath();

      if (!enabled) {
        // Disabling: save route info then remove from config
        const { stdout } = await execFileAsync(frpc, ['list', '--json', '--config', configPath]);
        const routes = JSON.parse(stdout) as Array<{
          Name: string; Type: string; LocalIP: string; LocalPort: number;
          Subdomain: string; TargetURL: string;
        }>;
        const route = routes.find((r) => r.Name === name);
        if (route) {
          const disabled = loadDisabledServices();
          if (!disabled.some((d) => d.name === name)) {
            disabled.push({
              name: route.Name,
              type: route.Type,
              target: route.TargetURL || `${route.LocalIP}:${route.LocalPort}`,
              localPort: route.LocalPort,
              subdomain: route.Subdomain || undefined,
            });
            saveDisabledServices(disabled);
          }
          await execFileAsync(frpc, ['remove', name, '--config', configPath]);
        }
      } else {
        // Enabling: restore route from disabled list
        const disabled = loadDisabledServices();
        const saved = disabled.find((d) => d.name === name);
        if (saved) {
          const args = [
            'add', '--target', saved.target,
            '--name', saved.name, '--no-verify',
            '--config', configPath,
          ];
          const tokens = auth.getTokens();
          if (tokens?.accessToken) args.push('--token', tokens.accessToken);
          await execFileAsync(frpc, args);
          saveDisabledServices(disabled.filter((d) => d.name !== name));
        }
      }

      // Hot-reload tunnel if running
      if (sidecar.isRunning()) {
        try { await sidecar.reload(); } catch { /* best effort */ }
      }

      return { success: true };
    } catch (err) {
      const message = (err as Error & { stderr?: string }).stderr || (err as Error).message;
      return { success: false, error: message.trim() };
    }
  });

  // --- QURL operations ---

  ipcMain.handle('qurls:create', async (_event, input: QURLCreateInput) => {
    try {
      const client = await getClient();
      if (!client) return { success: false, error: 'Sign in to create QURLs' };

      const result = await client.create({
        target_url: input.target_url,
        expires_in: input.expires_in,
        one_time_use: input.one_time_use,
        max_sessions: input.max_sessions,
        session_duration: input.session_duration,
        label: input.label,
        access_policy: input.access_policy,
      });

      return {
        success: true,
        qurl: {
          qurl_id: result.qurl_id,
          resource_id: result.resource_id,
          qurl_link: result.qurl_link,
          qurl_site: result.qurl_site,
          target_url: input.target_url,
          status: 'active' as const,
          expires_at: result.expires_at || null,
          one_time_use: input.one_time_use || false,
          created_at: new Date().toISOString(),
          label: input.label,
        },
      };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  ipcMain.handle('qurls:list', async (_event, params?: { limit?: number; cursor?: string; status?: string }) => {
    try {
      const client = await getClient();
      if (!client) return { success: false, error: 'Sign in to view QURLs' };

      const result = await client.list(params);
      return {
        success: true,
        qurls: result.qurls?.map((q) => ({
          qurl_id: q.resource_id,
          resource_id: q.resource_id,
          qurl_link: q.qurl_site || '',
          qurl_site: q.qurl_site || '',
          target_url: q.target_url,
          status: q.status || 'active',
          expires_at: q.expires_at || null,
          one_time_use: false,
          created_at: q.created_at,
          label: q.description,
        })) || [],
        has_more: result.has_more,
        next_cursor: result.next_cursor,
      };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  // Get resource detail with associated QURLs via direct API
  ipcMain.handle('qurls:get', async (_event, id: string) => {
    try {
      const tokens = auth.getTokens();
      if (!tokens?.accessToken) return { success: false, error: 'Sign in to view resources' };

      const result = await apiRequest<{ data: { resource: Record<string, unknown>; qurls: Record<string, unknown>[] } }>(
        'GET', `/v1/resources/${encodeURIComponent(id)}`
      );

      const r = result.data.resource;
      const qurls = (result.data.qurls || []).map((q: Record<string, unknown>) => ({
        qurl_id: q.qurl_id as string,
        label: q.label as string | undefined,
        status: (q.status as string) || 'active',
        one_time_use: q.one_time_use as boolean || false,
        max_sessions: q.max_sessions as number || 0,
        session_duration: q.session_duration as number | undefined,
        use_count: q.use_count as number || 0,
        qurl_site: q.qurl_site as string | undefined,
        created_at: q.created_at as string,
        expires_at: q.expires_at as string,
        access_policy: q.access_policy as AccessPolicy | undefined,
      }));

      return {
        success: true,
        resource: {
          resource_id: r.resource_id as string,
          target_url: r.target_url as string,
          status: r.status as string,
          created_at: r.created_at as string,
          expires_at: r.expires_at as string | undefined,
          description: r.description as string | undefined,
          tags: (r.tags as string[]) || [],
          qurl_site: r.qurl_site as string,
          qurl_count: (r.qurl_count as number) || qurls.length,
          custom_domain: (r.custom_domain as string) || null,
          qurls,
        },
      };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  ipcMain.handle('qurls:revoke', async (_event, resourceId: string) => {
    try {
      const client = await getClient();
      if (!client) return { success: false, error: 'Sign in to revoke QURLs' };

      await client.delete(resourceId);

      // Clean up any local share files associated with this resource
      for (const [id, share] of activeShares) {
        if (share.resourceId === resourceId) {
          if (share.filePath) { removeTokenDir(share.filePath); }
          activeShares.delete(id);
        }
      }
      persistShares();

      return { success: true };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  // Revoke a specific QURL token (not the whole resource)
  ipcMain.handle('qurls:revokeQurl', async (_event, resourceId: string, qurlId: string) => {
    try {
      const tokens = auth.getTokens();
      if (!tokens?.accessToken) return { success: false, error: 'Sign in to revoke QURLs' };

      await apiRequest('DELETE', `/v1/resources/${encodeURIComponent(resourceId)}/qurls/${encodeURIComponent(qurlId)}`);
      return { success: true };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  ipcMain.handle('qurls:mintLink', async (_event, resourceId: string, input?: Partial<QURLCreateInput>) => {
    try {
      const client = await getClient();
      if (!client) return { success: false, error: 'Sign in to mint links' };

      const result = await client.mintLink(resourceId, {
        expires_in: input?.expires_in,
        one_time_use: input?.one_time_use,
        label: input?.label,
        max_sessions: input?.max_sessions,
        session_duration: input?.session_duration,
        access_policy: input?.access_policy,
      });
      return {
        success: true,
        qurl: {
          qurl_id: resourceId,
          resource_id: resourceId,
          qurl_link: result.qurl_link,
          qurl_site: '',
          target_url: '',
          status: 'active' as const,
          expires_at: result.expires_at || null,
          one_time_use: input?.one_time_use || false,
          created_at: new Date().toISOString(),
          label: input?.label,
        },
      };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  // --- Session management (direct API) ---

  ipcMain.handle('qurls:getSessions', async (_event, resourceId: string) => {
    try {
      const tokens = auth.getTokens();
      if (!tokens?.accessToken) return { success: false, error: 'Sign in to view sessions' };

      const result = await apiRequest<{ data: Record<string, unknown>[] }>(
        'GET', `/v1/resources/${encodeURIComponent(resourceId)}/sessions`
      );

      const sessions = (result.data || []).map((s: Record<string, unknown>) => ({
        session_id: s.session_id as string,
        qurl_id: s.qurl_id as string,
        src_ip: s.src_ip as string,
        user_agent: s.user_agent as string,
        created_at: s.created_at as string,
        last_seen_at: s.last_seen_at as string,
      }));

      return { success: true, sessions };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  ipcMain.handle('qurls:terminateSession', async (_event, resourceId: string, sessionId: string) => {
    try {
      const tokens = auth.getTokens();
      if (!tokens?.accessToken) return { success: false, error: 'Sign in to manage sessions' };

      const result = await apiRequest<{ data: { count: number } }>(
        'DELETE', `/v1/resources/${encodeURIComponent(resourceId)}/sessions/${encodeURIComponent(sessionId)}`
      );
      return { success: true, count: result.data?.count };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  ipcMain.handle('qurls:terminateAllSessions', async (_event, resourceId: string) => {
    try {
      const tokens = auth.getTokens();
      if (!tokens?.accessToken) return { success: false, error: 'Sign in to manage sessions' };

      const result = await apiRequest<{ data: { count: number } }>(
        'DELETE', `/v1/resources/${encodeURIComponent(resourceId)}/sessions`
      );
      return { success: true, count: result.data?.count };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  // --- Share: URL ---

  ipcMain.handle('share:url', async (_event, targetUrl: string, options?: Partial<QURLCreateInput>) => {
    try {
      const client = await getClient();
      if (!client) return { success: false, error: 'Sign in to share URLs' };

      const defaults = loadDefaults().url;
      const result = await client.create({
        target_url: targetUrl,
        expires_in: options?.expires_in || defaults.expires_in,
        one_time_use: options?.one_time_use ?? defaults.one_time_use,
        max_sessions: options?.max_sessions ?? defaults.max_sessions,
        label: options?.label,
        access_policy: options?.access_policy ?? defaults.access_policy,
      });

      return {
        success: true,
        qurl: {
          qurl_id: result.qurl_id,
          resource_id: result.resource_id,
          qurl_link: result.qurl_link,
          qurl_site: result.qurl_site,
          target_url: targetUrl,
          status: 'active' as const,
          expires_at: result.expires_at || null,
          one_time_use: options?.one_time_use ?? defaults.one_time_use,
          created_at: new Date().toISOString(),
          label: options?.label,
        },
      };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  // --- Share: Local URL (auto-creates tunnel) ---

  ipcMain.handle('share:urlLocal', async (_event, targetUrl: string, options?: Partial<QURLCreateInput>) => {
    try {
      const client = await getClient();
      if (!client) return { success: false, error: 'Sign in to share URLs' };

      const parsedUrl = new URL(targetUrl);
      const targetPort = parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');
      const routeName = `local-${targetPort}`;

      // Ensure config exists and create route if needed
      sidecar.ensureConfigExists();
      const frpc = getFrpcPath();
      const configPath = sidecar.getConfigPath();

      try {
        const { stdout } = await execFileAsync(frpc, ['list', '--json', '--config', configPath]);
        const routes = JSON.parse(stdout) as Array<{ Name: string }>;
        if (!routes.some((r) => r.Name === routeName)) {
          const addArgs = ['add', '--target', targetUrl, '--name', routeName, '--no-verify', '--config', configPath];
          const tokens = auth.getTokens();
          if (tokens?.accessToken) addArgs.push('--token', tokens.accessToken);
          await execFileAsync(frpc, addArgs);
        }
      } catch {
        // If list fails, try adding directly
        try {
          const addArgs = ['add', '--target', targetUrl, '--name', routeName, '--no-verify', '--config', configPath];
          const tokens = auth.getTokens();
          if (tokens?.accessToken) addArgs.push('--token', tokens.accessToken);
          await execFileAsync(frpc, addArgs);
        } catch { /* best effort */ }
      }

      // (Re)start sidecar to pick up config changes
      if (sidecar.isRunning()) {
        await sidecar.stop();
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await sidecar.start();
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Resolve public URL from route's subdomain
      let publicUrl = targetUrl;
      try {
        const { stdout } = await execFileAsync(frpc, ['list', '--json', '--config', configPath]);
        const routes = JSON.parse(stdout) as Array<{ Name: string; Subdomain: string }>;
        const route = routes.find((r) => r.Name === routeName);
        if (route?.Subdomain) {
          publicUrl = getTunnelTargetUrl(route.Subdomain);
        }
      } catch { /* fall through to original URL */ }

      // Create QURL pointing to the tunneled URL
      const defaults = loadDefaults().url;
      const qurlResult = await client.create({
        target_url: publicUrl,
        expires_in: options?.expires_in || defaults.expires_in,
        one_time_use: options?.one_time_use ?? defaults.one_time_use,
        max_sessions: options?.max_sessions ?? defaults.max_sessions,
        label: options?.label || targetUrl,
        access_policy: options?.access_policy ?? defaults.access_policy,
      });

      return {
        success: true,
        qurl: {
          qurl_id: qurlResult.qurl_id,
          resource_id: qurlResult.resource_id,
          qurl_link: qurlResult.qurl_link,
          qurl_site: qurlResult.qurl_site,
          target_url: publicUrl,
          status: 'active' as const,
          expires_at: qurlResult.expires_at || null,
          one_time_use: options?.one_time_use ?? defaults.one_time_use,
          created_at: new Date().toISOString(),
          label: options?.label || targetUrl,
        },
      };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  // --- Share: Service ---

  ipcMain.handle('share:service', async (_event, serviceName: string, options?: Partial<QURLCreateInput>) => {
    try {
      const client = await getClient();
      if (!client) return { success: false, error: 'Sign in to share services' };

      // Get route info from CLI
      const frpc = getFrpcPath();
      const { stdout } = await execFileAsync(frpc, ['list', '--json', '--config', sidecar.getConfigPath()]);
      const routes = JSON.parse(stdout) as Array<{
        Name: string;
        Subdomain: string;
        ResourceID: string;
        TargetURL: string;
      }>;

      const route = routes.find((r) => r.Name.toLowerCase() === serviceName.toLowerCase());
      if (!route) return { success: false, error: `Service "${serviceName}" not found` };
      if (!route.Subdomain) return { success: false, error: `Service "${serviceName}" has no public subdomain` };

      const targetUrl = getTunnelTargetUrl(route.Subdomain);
      const defaults = loadDefaults().service;

      const result = await client.create({
        target_url: targetUrl,
        expires_in: options?.expires_in || defaults.expires_in,
        one_time_use: options?.one_time_use ?? defaults.one_time_use,
        session_duration: options?.session_duration ?? defaults.session_duration,
        label: options?.label || serviceName,
        access_policy: options?.access_policy ?? defaults.access_policy,
      });

      return {
        success: true,
        qurl: {
          qurl_id: result.qurl_id,
          resource_id: result.resource_id,
          qurl_link: result.qurl_link,
          qurl_site: result.qurl_site,
          target_url: targetUrl,
          status: 'active' as const,
          expires_at: result.expires_at || null,
          one_time_use: options?.one_time_use ?? defaults.one_time_use,
          created_at: new Date().toISOString(),
          label: options?.label || serviceName,
        },
      };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  // --- Share: File ---

  ipcMain.handle('share:file', async (_event, filePath: string, name: string, options?: Partial<QURLCreateInput>) => {
    try {
      const client = await getClient();
      if (!client) return { success: false, error: 'Sign in to share files' };

      const id = crypto.randomUUID();
      const token = id.slice(0, 12);
      // Sanitize filename: replace special Unicode spaces (narrow no-break space, etc.)
      // with regular spaces to avoid URL encoding issues
      const rawName = name || path.basename(filePath);
      const fileName = rawName.replace(/[\u00A0\u2002-\u200B\u202F\u205F\u3000]/g, ' ');

      // Copy file to managed share directory with sanitized filename
      const shareDir = ensureShareDir();
      const tokenDir = path.join(shareDir, token);
      fs.mkdirSync(tokenDir, { recursive: true });
      const destPath = path.join(tokenDir, fileName);
      fs.copyFileSync(filePath, destPath);

      // Ensure persistent file server is running
      const result = await ensureFileServer();

      // Ensure config exists before any CLI calls
      sidecar.ensureConfigExists();
      const frpc = getFrpcPath();
      const configPath = sidecar.getConfigPath();

      // Step 1: Ensure qurl-files FRP route exists with the CORRECT port
      // Remove stale route first (port may have changed), then re-add with current port.
      try {
        const { stdout } = await execFileAsync(frpc, ['list', '--json', '--config', configPath]);
        const routes = JSON.parse(stdout) as Array<{ Name: string; LocalPort: number }>;
        const existingRoute = routes.find((r) => r.Name === 'qurl-files');
        if (existingRoute && existingRoute.LocalPort !== result.port) {
          // Port mismatch — remove stale route and re-add
          await execFileAsync(frpc, ['remove', 'qurl-files', '--config', configPath]);
        }
        if (!existingRoute || existingRoute.LocalPort !== result.port) {
          const addArgs = ['add', '--target', `http://127.0.0.1:${result.port}`, '--name', 'qurl-files', '--no-verify', '--config', configPath];
          const tokens = auth.getTokens();
          if (tokens?.accessToken) addArgs.push('--token', tokens.accessToken);
          await execFileAsync(frpc, addArgs);
        }
      } catch {
        // If list fails (fresh config), add route directly
        try {
          const addArgs = ['add', '--target', `http://127.0.0.1:${result.port}`, '--name', 'qurl-files', '--no-verify', '--config', configPath];
          const tokens = auth.getTokens();
          if (tokens?.accessToken) addArgs.push('--token', tokens.accessToken);
          await execFileAsync(frpc, addArgs);
        } catch {
          // Best effort — binary may be unavailable
        }
      }

      // Step 2: (Re)start sidecar to pick up config changes.
      // reload() is unreliable (FRP drops proxies on reload), so we do a full restart.
      if (sidecar.isRunning()) {
        await sidecar.stop();
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await sidecar.start();
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Step 3: Get the file route's subdomain for the public URL
      // Use sanitized fileName (not original filePath basename) for URL construction
      const encodedFileName = encodeURIComponent(fileName);
      let publicUrl = `http://127.0.0.1:${result.port}/${token}/${encodedFileName}`;
      try {
        const { stdout } = await execFileAsync(frpc, ['list', '--json', '--config', configPath]);
        const routes = JSON.parse(stdout) as Array<{ Name: string; Subdomain: string }>;
        const fileRoute = routes.find((r) => r.Name === 'qurl-files');
        if (fileRoute?.Subdomain) {
          publicUrl = getTunnelTargetUrl(fileRoute.Subdomain, `${token}/${encodedFileName}`);
        }
      } catch {
        // Fall through to local URL
      }

      // Create QURL for the file
      const defaults = loadDefaults().file;
      const qurlResult = await client.create({
        target_url: publicUrl,
        expires_in: options?.expires_in || defaults.expires_in,
        one_time_use: options?.one_time_use ?? defaults.one_time_use,
        label: options?.label || fileName,
        access_policy: options?.access_policy ?? defaults.access_policy,
      });

      const share: ActiveShare = {
        id,
        name: fileName,
        filePath: destPath,
        port: result.port,
        url: result.url,
        createdAt: Date.now(),
        expiresAt: null,
        qurlId: qurlResult.qurl_id,
        resourceId: qurlResult.resource_id,
      };

      activeShares.set(id, share);
      persistShares();

      return {
        success: true,
        qurl: {
          qurl_id: qurlResult.qurl_id,
          resource_id: qurlResult.resource_id,
          qurl_link: qurlResult.qurl_link,
          qurl_site: qurlResult.qurl_site,
          target_url: publicUrl,
          status: 'active' as const,
          expires_at: qurlResult.expires_at || null,
          one_time_use: options?.one_time_use ?? defaults.one_time_use,
          created_at: new Date().toISOString(),
          label: fileName,
        },
      };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  ipcMain.handle('share:stop', async (_event, id: string) => {
    try {
      const share = activeShares.get(id);

      // Revoke QURL if one was created
      if (share?.resourceId) {
        try {
          const client = await getClient();
          if (client) await client.delete(share.resourceId);
        } catch {
          // Best effort revocation
        }
      }

      // Clean up share directory
      if (share?.filePath) {
        const tokenDir = path.dirname(share.filePath);
        try {
          fs.rmSync(tokenDir, { recursive: true, force: true });
        } catch {
          // Best effort cleanup
        }
      }

      activeShares.delete(id);
      persistShares();
      return { success: true };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  ipcMain.handle('shares:list', () => {
    return Array.from(activeShares.values());
  });

  // --- URL detection ---

  ipcMain.handle('share:detectUrl', async (_event, url: string) => {
    const local = isLocalUrl(url);
    let hasRoute = false;
    let routeName: string | undefined;

    if (local) {
      try {
        const frpc = getFrpcPath();
        const { stdout } = await execFileAsync(frpc, ['list', '--json', '--config', sidecar.getConfigPath()]);
        const routes = JSON.parse(stdout) as Array<{ Name: string; TargetURL: string; LocalPort: number }>;
        const parsedUrl = new URL(url);
        const targetPort = parseInt(parsedUrl.port || '80', 10);

        const match = routes.find((r) => r.LocalPort === targetPort);
        if (match) {
          hasRoute = true;
          routeName = match.Name;
        }
      } catch {
        // Binary not available or no config
      }
    }

    return { success: true, isLocal: local, hasRoute, routeName };
  });

  // --- Settings ---

  ipcMain.handle('settings:getDefaults', () => {
    return loadDefaults();
  });

  ipcMain.handle('settings:setDefaults', (_event, defaults: Partial<QURLDefaults>) => {
    try {
      saveDefaults(defaults);
      return { success: true };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  // --- Dialog helpers ---

  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'openDirectory', 'multiSelections'],
    });
    if (result.canceled) return null;
    return result.filePaths;
  });

  ipcMain.handle('dialog:readImagePreview', async (_event, filePath: string) => {
    try {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp',
      };
      const mime = mimeMap[ext] || 'image/png';
      return `data:${mime};base64,${data.toString('base64')}`;
    } catch {
      return null;
    }
  });

  ipcMain.handle('dialog:openExternal', async (_event, url: string) => {
    const { shell } = require('electron');
    await shell.openExternal(url);
  });

  // --- Updates ---

  ipcMain.handle('update:check', async () => {
    try {
      const result = await updater.checkForUpdates();
      return result;
    } catch {
      return { tunnelUpdate: null, appUpdate: null };
    }
  });

  ipcMain.handle('update:applyAndRelaunch', async () => {
    try {
      const result = await updater.applyAndRelaunch(sidecar);
      return { success: true, restarted: result.restarted };
    } catch (err) {
      return { success: false, error: formatApiError(err) };
    }
  });

  // --- App Info ---

  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });
}

export function cleanupShares(): void {
  if (sharedFileServer) {
    sharedFileServer.stop();
    sharedFileServer = null;
  }
  activeShares.clear();
  sidecar.stop();
}

/**
 * Initialize the file server on app startup if shares exist.
 * This ensures the qurl-files tunnel route can serve existing shares.
 */
/**
 * On app startup: restore persisted shares, verify they're still active,
 * start file server if needed, clean up stale files and routes.
 */
export async function initFileServer(): Promise<void> {
  // Load persisted shares from previous session
  const persisted = loadPersistedShares();

  // Check which resources are still active via the API
  let client: Awaited<ReturnType<typeof getClient>> = null;
  try { client = await getClient(); } catch { /* not signed in yet */ }

  for (const share of persisted) {
    let isActive = false;
    if (client && share.resourceId) {
      try {
        const q = await client.get(share.resourceId);
        isActive = q.status === 'active';
      } catch { /* resource not found = not active */ }
    }

    if (isActive && share.filePath && fs.existsSync(share.filePath)) {
      // Restore this share
      activeShares.set(share.id, share);
    } else {
      // Clean up revoked/expired/missing share files
      if (share.filePath) { removeTokenDir(share.filePath); }
    }
  }

  // Remove orphaned token directories not in activeShares
  cleanOrphanedShares();
  persistShares();

  // Start the file server if there are active shares to serve
  if (activeShares.size > 0) {
    await ensureFileServer();
  }
  // Note: qurl-files route is always kept (managed by sidecar.ensureFilesRoute).
  // The file server starts on-demand when files are shared.

  // Auto-start tunnel if enabled in settings
  const defaults = loadDefaults();
  if (defaults.autoStartTunnel) {
    try {
      await sidecar.start();
    } catch {
      // Best effort — user will see "Disconnected" and can start manually
    }
  }

  // Periodic cleanup: remove files whose QURLs are no longer active
  setInterval(() => cleanupStaleShares(), 60_000);
}

/**
 * Check all active shares against the API and remove files whose
 * QURLs have expired or been revoked.
 */
async function cleanupStaleShares(): Promise<void> {
  if (activeShares.size === 0) return;

  const tokens = auth.getTokens();
  if (!tokens?.accessToken) return;

  let changed = false;
  for (const [id, share] of activeShares) {
    let shouldRemove = false;
    try {
      if (share.resourceId) {
        // Use apiRequest directly to get resource + qurls (SDK client.get doesn't include qurls)
        const result = await apiRequest<{ data: { resource: Record<string, unknown>; qurls: Array<{ status: string }> } }>(
          'GET', `/v1/resources/${encodeURIComponent(share.resourceId)}`
        );
        const resource = result.data.resource;
        const qurls = result.data.qurls || [];

        if (resource.status !== 'active') {
          shouldRemove = true;
        } else {
          const hasActiveQurl = qurls.some((q) => q.status === 'active');
          if (!hasActiveQurl) shouldRemove = true;
        }
      }
    } catch {
      // Resource not found or API error = remove
      shouldRemove = true;
    }

    if (shouldRemove) {
      if (share.filePath) removeTokenDir(share.filePath);
      activeShares.delete(id);
      changed = true;
    }
  }

  if (changed) {
    persistShares();
    cleanOrphanedShares();
  }
}
