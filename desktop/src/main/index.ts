import { app, BrowserWindow, nativeImage } from 'electron';
import path from 'path';
import { setupIpcHandlers, cleanupShares, initFileServer } from './ipc';
import { createTray, destroyTray } from './tray';
import { sidecar } from './ipc';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 640,
    minHeight: 480,
    title: 'QURL Desktop',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0e27',
    icon: path.join(__dirname, '..', '..', 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for File.path in drag-and-drop
    },
  });

  // In development, load from Vite dev server
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // In production, load the built renderer
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  // Close to tray on macOS instead of quitting
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

let isQuitting = false;

app.whenReady().then(async () => {
  // Set dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(__dirname, '..', '..', 'resources', 'icon.png');
    try {
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) app.dock.setIcon(icon);
    } catch { /* best effort */ }
  }

  setupIpcHandlers();
  createWindow();
  createTray(() => mainWindow, sidecar);
  // Start file server if existing shares need serving
  await initFileServer();

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show();
    } else {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    cleanupShares();
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  cleanupShares();
  destroyTray();
});
