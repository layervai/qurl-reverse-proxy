import { ipcMain, dialog } from 'electron';
import { SidecarManager } from './sidecar';
import { FileServer } from './file-server';
import * as auth from './auth';
import crypto from 'crypto';
import path from 'path';
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
}

interface TunnelService {
  name: string;
  type: 'http' | 'tcp' | 'ssh';
  target: string;
  localPort: number;
  subdomain?: string;
  status: 'connected' | 'disconnected' | 'error';
}

export const sidecar = new SidecarManager();
const fileServers = new Map<string, FileServer>();
const activeShares = new Map<string, ActiveShare>();

let nextPort = 9876;

function getNextPort(): number {
  return nextPort++;
}

// Get the qurl-frpc binary path for CLI operations (add/remove/list)
function getFrpcPath(): string {
  return sidecar.getBinaryPath();
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

  ipcMain.handle('auth:signOut', () => {
    auth.signOut();
    return { success: true };
  });

  ipcMain.handle('auth:status', () => {
    const tokens = auth.getTokens();
    return {
      signedIn: tokens !== null,
      email: tokens?.email || null,
      environment: auth.getEnvironment(),
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
      }>;

      const tunnels: TunnelService[] = routes.map((r) => ({
        name: r.Name,
        type: (r.Type === 'frp_http' ? 'http' : r.Type === 'frp_tcp' ? 'tcp' : 'tcp') as TunnelService['type'],
        target: r.TargetURL || `${r.LocalIP}:${r.LocalPort}`,
        localPort: r.LocalPort,
        subdomain: r.Subdomain || undefined,
        status: sidecar.isRunning() ? 'connected' : 'disconnected',
      }));

      return tunnels;
    } catch {
      // No config or binary not found — return empty list
      return [];
    }
  });

  ipcMain.handle('tunnels:add', async (_event, target: string, name: string) => {
    try {
      const frpc = getFrpcPath();
      await execFileAsync(frpc, ['add', '--target', target, '--name', name, '--no-verify']);

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

  // --- File sharing ---

  ipcMain.handle('share:file', async (_event, filePath: string, name: string) => {
    try {
      const id = crypto.randomUUID();
      const port = getNextPort();
      const server = new FileServer(port);
      const result = await server.serve(filePath);

      const share: ActiveShare = {
        id,
        name: name || path.basename(filePath),
        filePath,
        port: result.port,
        url: result.url,
        createdAt: Date.now(),
        expiresAt: null,
      };

      fileServers.set(id, server);
      activeShares.set(id, share);

      return {
        success: true,
        share: {
          ...share,
          qurlLink: `https://q.layerv.ai/${id.slice(0, 8)}`,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('share:stop', async (_event, id: string) => {
    try {
      const server = fileServers.get(id);
      if (server) {
        await server.stop();
        fileServers.delete(id);
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
