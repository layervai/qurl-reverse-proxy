import { ipcMain, dialog, app } from 'electron';
import { SidecarManager } from './sidecar';
import { FileServer } from './file-server';
import { getClient, clearClient } from './qurl-api';
import * as auth from './auth';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
const fileServers = new Map<string, FileServer>();
const activeShares = new Map<string, ActiveShare>();

const SHARE_DIR = path.join(app.getPath('userData'), 'shares');
const DEFAULTS_PATH = path.join(app.getPath('userData'), 'qurl-defaults.json');

let nextPort = 9876;

function getNextPort(): number {
  return nextPort++;
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

export function setupIpcHandlers(): void {
  // --- Auth ---

  ipcMain.handle('auth:signIn', async () => {
    try {
      const tokens = await auth.signIn();
      return { success: true, email: tokens.email, environment: tokens.environment };
    } catch (err) {
      return { success: false, error: (err as Error).message };
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
      return { success: false, error: (err as Error).message };
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
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('sidecar:stop', async () => {
    try {
      await sidecar.stop();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('sidecar:status', () => {
    return sidecar.getStatus();
  });

  // --- Tunnel/service management (uses qurl-frpc CLI) ---

  ipcMain.handle('tunnels:list', async () => {
    try {
      const frpc = getFrpcPath();
      const { stdout } = await execFileAsync(frpc, ['list', '--json']);
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
        publicUrl: r.Subdomain ? `https://${r.Subdomain}.qurl.site` : undefined,
        status: sidecar.isRunning() ? 'connected' : 'disconnected',
      }));

      return tunnels;
    } catch {
      return [];
    }
  });

  ipcMain.handle('tunnels:add', async (_event, target: string, name: string) => {
    try {
      const frpc = getFrpcPath();
      const args = ['add', '--target', target, '--name', name, '--no-verify'];

      // Pass token if available for resource registration
      const tokens = auth.getTokens();
      if (tokens?.accessToken) {
        args.push('--token', tokens.accessToken);
      }

      await execFileAsync(frpc, args);

      const tunnel: TunnelService = {
        name,
        type: target.startsWith('http') ? 'http' : 'tcp',
        target,
        localPort: parseInt(new URL(target).port || '80', 10),
        status: 'disconnected',
      };

      return { success: true, tunnel };
    } catch (err) {
      const message = (err as Error & { stderr?: string }).stderr || (err as Error).message;
      return { success: false, error: message.trim() };
    }
  });

  ipcMain.handle('tunnels:remove', async (_event, name: string) => {
    try {
      const frpc = getFrpcPath();
      await execFileAsync(frpc, ['remove', name]);
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
      return { success: false, error: (err as Error).message };
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
          qurl_link: '',
          qurl_site: q.qurl_site,
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
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('qurls:get', async (_event, id: string) => {
    try {
      const client = await getClient();
      if (!client) return { success: false, error: 'Sign in to view QURLs' };

      const q = await client.get(id);
      return { success: true, qurl: q };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('qurls:revoke', async (_event, resourceId: string) => {
    try {
      const client = await getClient();
      if (!client) return { success: false, error: 'Sign in to revoke QURLs' };

      await client.delete(resourceId);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
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
      });
      return {
        success: true,
        qurl: {
          qurl_id: resourceId,
          resource_id: resourceId,
          qurl_link: result.qurl_link,
          target_url: '',
          status: 'active' as const,
          expires_at: result.expires_at || null,
          one_time_use: input?.one_time_use || false,
          created_at: new Date().toISOString(),
          label: input?.label,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
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
      return { success: false, error: (err as Error).message };
    }
  });

  // --- Share: Service ---

  ipcMain.handle('share:service', async (_event, serviceName: string, options?: Partial<QURLCreateInput>) => {
    try {
      const client = await getClient();
      if (!client) return { success: false, error: 'Sign in to share services' };

      // Get route info from CLI
      const frpc = getFrpcPath();
      const { stdout } = await execFileAsync(frpc, ['list', '--json']);
      const routes = JSON.parse(stdout) as Array<{
        Name: string;
        Subdomain: string;
        ResourceID: string;
        TargetURL: string;
      }>;

      const route = routes.find((r) => r.Name.toLowerCase() === serviceName.toLowerCase());
      if (!route) return { success: false, error: `Service "${serviceName}" not found` };
      if (!route.Subdomain) return { success: false, error: `Service "${serviceName}" has no public subdomain` };

      const targetUrl = `https://${route.Subdomain}.qurl.site`;
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
      return { success: false, error: (err as Error).message };
    }
  });

  // --- Share: File ---

  ipcMain.handle('share:file', async (_event, filePath: string, name: string, options?: Partial<QURLCreateInput>) => {
    try {
      const client = await getClient();
      if (!client) return { success: false, error: 'Sign in to share files' };

      const id = crypto.randomUUID();
      const token = id.slice(0, 12);
      const fileName = name || path.basename(filePath);

      // Copy file to managed share directory
      const shareDir = ensureShareDir();
      const tokenDir = path.join(shareDir, token);
      fs.mkdirSync(tokenDir, { recursive: true });
      const destPath = path.join(tokenDir, path.basename(filePath));
      fs.copyFileSync(filePath, destPath);

      // Start or reuse file server
      const port = getNextPort();
      const server = new FileServer(port);
      const result = await server.serve(shareDir);

      // Auto-start sidecar if not running
      if (!sidecar.isRunning()) {
        await sidecar.start();
        // Brief wait for tunnel to establish
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // Ensure file-server FRP route exists
      const frpc = getFrpcPath();
      try {
        const { stdout } = await execFileAsync(frpc, ['list', '--json']);
        const routes = JSON.parse(stdout) as Array<{ Name: string }>;
        const hasFileRoute = routes.some((r) => r.Name === 'qurl-files');
        if (!hasFileRoute) {
          const addArgs = ['add', '--target', `http://127.0.0.1:${result.port}`, '--name', 'qurl-files', '--no-verify'];
          const tokens = auth.getTokens();
          if (tokens?.accessToken) addArgs.push('--token', tokens.accessToken);
          await execFileAsync(frpc, addArgs);
        }
      } catch {
        // Best effort — route may already exist or binary unavailable
      }

      // Get the file route's subdomain for the public URL
      let publicUrl = `http://127.0.0.1:${result.port}/${token}/${path.basename(filePath)}`;
      try {
        const { stdout } = await execFileAsync(frpc, ['list', '--json']);
        const routes = JSON.parse(stdout) as Array<{ Name: string; Subdomain: string }>;
        const fileRoute = routes.find((r) => r.Name === 'qurl-files');
        if (fileRoute?.Subdomain) {
          publicUrl = `https://${fileRoute.Subdomain}.qurl.site/${token}/${path.basename(filePath)}`;
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

      fileServers.set(id, server);
      activeShares.set(id, share);

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
      return { success: false, error: (err as Error).message };
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

      // Stop file server
      const server = fileServers.get(id);
      if (server) {
        await server.stop();
        fileServers.delete(id);
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
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
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
        const { stdout } = await execFileAsync(frpc, ['list', '--json']);
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
      return { success: false, error: (err as Error).message };
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
}

export function cleanupShares(): void {
  for (const [id, server] of fileServers) {
    server.stop();
    fileServers.delete(id);
  }
  activeShares.clear();
  sidecar.stop();
}
