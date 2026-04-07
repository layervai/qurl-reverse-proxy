import { ipcMain, dialog } from 'electron';
import { SidecarManager } from './sidecar';
import { FileServer } from './file-server';
import crypto from 'crypto';
import path from 'path';

interface ActiveShare {
  id: string;
  name: string;
  filePath: string;
  port: number;
  url: string;
  createdAt: number;
  expiresAt: number | null;
}

const sidecar = new SidecarManager();
const fileServers = new Map<string, FileServer>();
const activeShares = new Map<string, ActiveShare>();

let nextPort = 9876;

function getNextPort(): number {
  return nextPort++;
}

export function setupIpcHandlers(): void {
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

      // TODO: In the full implementation, this would:
      // 1. Call the QURL API to create a short link
      // 2. Configure the frpc proxy to expose this port
      // For now, return the local URL as a placeholder
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
