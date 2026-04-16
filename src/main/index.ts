import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc.js';
import { getDb, closeDb } from './library/db.js';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devServer) {
    void mainWindow.loadURL(devServer);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function configureSecurity(): void {
  // Only allow navigation to the dev server in development. In production we
  // load a local file so any navigation attempt is already blocked.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      const devServer = process.env['ELECTRON_RENDERER_URL'];
      if (devServer && url.startsWith(devServer)) return;
      event.preventDefault();
      void shell.openExternal(url);
    });
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' data: blob: file: https://www.youtube.com https://*.ytimg.com; " +
            "img-src 'self' data: blob: https: file:; " +
            "media-src 'self' blob: file:; " +
            "frame-src https://www.youtube.com https://www.youtube-nocookie.com; " +
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
            "connect-src 'self' https: wss:;"
        ]
      }
    });
  });
}

app.whenReady().then(() => {
  // Warm the library up front so migrations run immediately.
  try {
    getDb();
  } catch (err) {
    console.error('[fmusic] Failed to initialize library database:', err);
  }

  configureSecurity();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDb();
    app.quit();
  }
});

app.on('before-quit', () => {
  closeDb();
});
