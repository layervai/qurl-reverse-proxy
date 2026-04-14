import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { SidecarManager } from './sidecar';

let tray: Tray | null = null;
let menuInterval: ReturnType<typeof setInterval> | null = null;

export function createTray(
  getMainWindow: () => BrowserWindow | null,
  sidecar: SidecarManager,
): void {
  const icon = loadTrayIcon();
  if (!icon) {
    console.warn('Could not load tray icon, skipping tray setup');
    return;
  }

  try {
    tray = new Tray(icon);
  } catch (err) {
    console.warn('Failed to create tray:', err);
    return;
  }

  tray.setToolTip('QURL Desktop');

  const statusLabels: Record<string, string> = {
    running: '\u{1F7E2} Connected',
    reconnecting: '\u{1F7E1} Reconnecting...',
    disconnected: '\u26AA Disconnected',
  };

  const updateMenu = async () => {
    if (!tray || tray.isDestroyed()) {
      if (menuInterval) { clearInterval(menuInterval); menuInterval = null; }
      return;
    }

    const state = await sidecar.getConnectionState();
    const isActive = state === 'running' || state === 'reconnecting';

    const menu = Menu.buildFromTemplate([
      {
        label: statusLabels[state] || statusLabels.disconnected,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Quick Share...',
        click: () => showWindow(getMainWindow),
      },
      { type: 'separator' },
      {
        label: isActive ? 'Stop Tunnel' : 'Start Tunnel',
        click: async () => {
          try {
            if (isActive) await sidecar.stop();
            else await sidecar.start();
          } catch { /* errors shown in UI */ }
          updateMenu();
        },
      },
      { type: 'separator' },
      { label: 'Show Window', click: () => showWindow(getMainWindow) },
      { label: 'Quit QURL', click: () => app.quit() },
    ]);

    tray!.setContextMenu(menu);
  };

  updateMenu();
  menuInterval = setInterval(updateMenu, 5000);

  tray.on('click', () => showWindow(getMainWindow));
}

export function destroyTray(): void {
  if (menuInterval) {
    clearInterval(menuInterval);
    menuInterval = null;
  }
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  tray = null;
}

function showWindow(getMainWindow: () => BrowserWindow | null): void {
  const win = getMainWindow();
  if (win) { win.show(); win.focus(); }
}

function loadTrayIcon(): Electron.NativeImage | null {
  // Try loading from resources/ directory (relative to app root)
  const candidates = [
    path.join(__dirname, '..', '..', 'resources', 'tray-icon.png'),
    path.join(process.cwd(), 'resources', 'tray-icon.png'),
    path.join(process.cwd(), '..', 'desktop', 'resources', 'tray-icon.png'),
  ];

  for (const iconPath of candidates) {
    if (fs.existsSync(iconPath)) {
      try {
        const img = nativeImage.createFromPath(iconPath);
        if (!img.isEmpty()) {
          // Add @2x retina version if available
          const ext = path.extname(iconPath);
          const retinaPath = iconPath.replace(ext, `@2x${ext}`);
          if (fs.existsSync(retinaPath)) {
            const retina = nativeImage.createFromPath(retinaPath);
            if (!retina.isEmpty()) {
              img.addRepresentation({ scaleFactor: 2.0, buffer: retina.toPNG() });
            }
          }
          img.setTemplateImage(true);
          return img;
        }
      } catch {
        continue;
      }
    }
  }

  // Fallback: create LayerV chevron icon programmatically
  try {
    const size = 22;
    const buf = Buffer.alloc(size * size * 4, 0); // transparent

    // Draw a pixel at (x,y) with alpha
    const setPixel = (x: number, y: number, alpha: number) => {
      const ix = Math.round(x), iy = Math.round(y);
      if (ix >= 0 && ix < size && iy >= 0 && iy < size) {
        const i = (iy * size + ix) * 4;
        buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0;
        buf[i + 3] = Math.min(255, buf[i + 3] + alpha);
      }
    };

    // Draw a line from (x0,y0) to (x1,y1)
    const drawLine = (x0: number, y0: number, x1: number, y1: number, alpha: number) => {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps;
        setPixel(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, alpha);
      }
    };

    // 4 chevrons (V shapes), scaled to 22x22 with padding
    const cx = 11, w = 8; // center x, half-width
    const chevrons = [3, 7, 11, 15]; // y positions for chevron tips
    const depth = 3; // how far down the V goes

    for (const baseY of chevrons) {
      // Left arm: (cx-w, baseY) -> (cx, baseY+depth)
      // Right arm: (cx, baseY+depth) -> (cx+w, baseY)
      for (let thick = -0.5; thick <= 0.5; thick += 0.5) {
        drawLine(cx - w, baseY + thick, cx, baseY + depth + thick, 220);
        drawLine(cx, baseY + depth + thick, cx + w, baseY + thick, 220);
      }
    }

    const img = nativeImage.createFromBitmap(buf, { width: size, height: size });
    img.setTemplateImage(true);
    return img;
  } catch {
    return null;
  }
}
