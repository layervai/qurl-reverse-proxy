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

  const updateMenu = () => {
    if (!tray || tray.isDestroyed()) {
      if (menuInterval) { clearInterval(menuInterval); menuInterval = null; }
      return;
    }

    const isRunning = sidecar.isRunning();

    const menu = Menu.buildFromTemplate([
      {
        label: isRunning ? '\u{1F7E2} Connected' : '\u26AA Disconnected',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Quick Share...',
        click: () => showWindow(getMainWindow),
      },
      { type: 'separator' },
      {
        label: isRunning ? 'Stop Tunnel' : 'Start Tunnel',
        click: async () => {
          try {
            if (isRunning) await sidecar.stop();
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
          img.setTemplateImage(true);
          return img;
        }
      } catch {
        continue;
      }
    }
  }

  // Fallback: create a simple 16x16 icon programmatically
  try {
    // Use createFromBitmap — a 16x16 RGBA buffer
    const size = 16;
    const buf = Buffer.alloc(size * size * 4, 0); // transparent

    // Draw a simple dot/circle in the center
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - 8, dy = y - 7;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= 4.5 && dist <= 6.5) {
          const i = (y * size + x) * 4;
          buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 255;
        }
      }
    }
    const img = nativeImage.createFromBitmap(buf, { width: size, height: size });
    img.setTemplateImage(true);
    return img;
  } catch {
    return null;
  }
}
