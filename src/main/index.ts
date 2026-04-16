import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from 'electron';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { registerIpc } from './ipc.js';
import { getSettings } from './settings.js';
import { getDb, closeDb } from './library/db.js';
import { ensureBuiltinPlaylists } from './library/playlists-repo.js';
import { getTrack, resolveTrackFilePath } from './library/tracks-repo.js';
import { stopActiveSonos } from './sonos.js';
import { stopAudioServer } from './sonos-server.js';
import { createTray, destroyTray, updateTray, type TrayPlayerState } from './tray.js';
import { createMiniPlayer, showMiniPlayer, hideMiniPlayer, getMiniPlayer } from './miniplayer.js';
import { initUpdater } from './app-updater.js';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

export const MEDIA_SCHEME = 'fmusic-media';

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

function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.mp3': return 'audio/mpeg';
    case '.m4a': case '.aac': return 'audio/aac';
    case '.ogg': return 'audio/ogg';
    case '.opus': return 'audio/ogg; codecs=opus';
    case '.flac': return 'audio/flac';
    case '.wav': return 'audio/wav';
    default: return 'audio/mpeg';
  }
}

function registerMediaProtocol(): void {
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

      const stat = fs.statSync(actualPath);
      const total = stat.size;
      const mime = mimeForExt(path.extname(actualPath));
      const rangeHeader = request.headers.get('range');

      if (rangeHeader) {
        const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (m) {
          const start = parseInt(m[1], 10);
          const end = m[2] ? parseInt(m[2], 10) : total - 1;
          const chunkSize = end - start + 1;
          const nodeStream = fs.createReadStream(actualPath, { start, end });
          const webStream = Readable.toWeb(nodeStream) as ReadableStream;
          return new Response(webStream, {
            status: 206,
            headers: {
              'Content-Type': mime,
              'Content-Range': `bytes ${start}-${end}/${total}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(chunkSize)
            }
          });
        }
      }

      const nodeStream = fs.createReadStream(actualPath);
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;
      return new Response(webStream, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(total)
        }
      });
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

  // Intercept close: hide to tray or quit depending on user setting.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      const { closeToTray } = getSettings();
      if (closeToTray) {
        e.preventDefault();
        mainWindow?.hide();
      } else {
        isQuitting = true;
        app.quit();
      }
    }
  });

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

  // Create tray + mini player after window exists.
  // Left-click on tray: toggle mini player (show if hidden, hide if visible).
  createTray(mainWindow!, () => {
    const { miniPlayerEnabled } = getSettings();
    if (miniPlayerEnabled) {
      const mini = getMiniPlayer();
      if (!mini) return;
      if (mini.isVisible()) {
        mini.hide();
      } else {
        mini.show();
        mini.focus();
      }
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
  createMiniPlayer();
  initUpdater();

  // Main renderer → tray menu update.
  ipcMain.on('tray:player-state', (_evt, state: TrayPlayerState) => {
    if (mainWindow) updateTray(mainWindow, state);
  });

  // Main renderer → forward state to mini player window; cache for late subscribers.
  let lastMiniState: unknown = null;
  ipcMain.on('mini:state-from-main', (_evt, state: unknown) => {
    lastMiniState = state;
    getMiniPlayer()?.webContents.send('mini:state', state);
  });

  // Mini player → forward commands to main renderer (reuses tray:command channel).
  ipcMain.on('mini:command', (_evt, cmd: string) => {
    if (cmd === 'expand') {
      hideMiniPlayer();
      mainWindow?.show();
      mainWindow?.focus();
    } else if (cmd === 'request-state') {
      // Mini player just mounted — replay last known state so it isn't blank.
      if (lastMiniState !== null) {
        getMiniPlayer()?.webContents.send('mini:state', lastMiniState);
      }
    } else {
      mainWindow?.webContents.send('tray:command', cmd);
    }
  });

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
});

// Never fires when window just hides, only when app.quit() is called.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit here — the tray keeps the app alive.
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  destroyTray();
  void stopActiveSonos();
  stopAudioServer();
  closeDb();
});
