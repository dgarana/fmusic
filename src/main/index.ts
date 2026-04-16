import { app, BrowserWindow, net, protocol, session, shell } from 'electron';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { registerIpc } from './ipc.js';
import { getDb, closeDb } from './library/db.js';
import { ensureBuiltinPlaylists } from './library/playlists-repo.js';
import { getTrack, resolveTrackFilePath } from './library/tracks-repo.js';
import { stopActiveSonos } from './sonos.js';
import { stopAudioServer } from './sonos-server.js';

let mainWindow: BrowserWindow | null = null;

export const MEDIA_SCHEME = 'fmusic-media';

// Register the scheme as privileged before the app is ready so the renderer
// can load it from `<audio>` elements regardless of its own origin (which in
// dev mode is http://localhost and would otherwise reject file:// URLs).
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

function registerMediaProtocol(): void {
  // URL shape: fmusic-media://track/<id>  →  local audio file for that track.
  // Delegating to `net.fetch(file://...)` lets Electron's network stack
  // handle range requests, which HTML audio elements rely on for seeking.
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'track') {
        return new Response('unknown resource', { status: 404 });
      }
      const id = parseInt(url.pathname.replace(/^\//, ''), 10);
      if (!Number.isFinite(id)) {
        return new Response('invalid id', { status: 400 });
      }
      const track = getTrack(id);
      if (!track) return new Response('track not found', { status: 404 });
      const actualPath = resolveTrackFilePath(track);
      if (!actualPath) {
        return new Response('file missing on disk', { status: 404 });
      }
      return net.fetch(pathToFileURL(actualPath).toString());
    } catch (err) {
      console.error('[fmusic-media] handler error:', err);
      return new Response('internal error', { status: 500 });
    }
  });
}

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
            "media-src 'self' blob: file: fmusic-media: https://*.googlevideo.com https://*.youtube.com; " +
            "frame-src https://www.youtube.com https://www.youtube-nocookie.com; " +
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
            "connect-src 'self' https: wss: fmusic-media:;"
        ]
      }
    });
  });
}

app.whenReady().then(() => {
  // Warm the library up front so migrations run immediately.
  try {
    getDb();
    ensureBuiltinPlaylists();
  } catch (err) {
    console.error('[fmusic] Failed to initialize library database:', err);
  }

  registerMediaProtocol();
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
  void stopActiveSonos();
  stopAudioServer();
  closeDb();
});
