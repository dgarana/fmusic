import { app, BrowserWindow, ipcMain, nativeImage, protocol, session, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { Channels } from '../shared/channels.js';
import { registerIpc } from './ipc.js';
import { getSettings } from './settings.js';
import { getDb, closeDb } from './library/db.js';
import { ensureBuiltinPlaylists } from './library/playlists-repo.js';
import { getTrack, getTrackEmbeddedArtwork, resolveTrackFilePath, warmTrackArtworkCache, cleanupMissingTracks } from './library/tracks-repo.js';
import { stopActiveSonos } from './sonos.js';
import {
  updateRemoteControllerSnapshot,
  setRemoteControllerCommandHandler
} from './remote-controller-server.js';
import { startUnifiedServer, stopUnifiedServer } from './server-manager.js';
import { createTray, destroyTray, updateTray, type TrayPlayerState } from './tray.js';
import { createMiniPlayer, showMiniPlayer, hideMiniPlayer, getMiniPlayer } from './miniplayer.js';
import { initUpdater } from './app-updater.js';
import { runScreenshotCapture, screenshotMode, seedScreenshotDemoData } from './screenshot-mode.js';
import { parseRange } from './network.js';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

export const MEDIA_SCHEME = 'fmusic-media';

if (process.env.FMUSIC_SCREENSHOT_USER_DATA_DIR) {
  app.setPath('userData', process.env.FMUSIC_SCREENSHOT_USER_DATA_DIR);
}

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
      if (url.hostname !== 'track' && url.hostname !== 'artwork' && url.hostname !== 'app-icon') {
        return new Response('unknown resource', { status: 404 });
      }
      
      if (url.hostname === 'app-icon') {
        const iconPath = app.isPackaged
          ? path.join(process.resourcesPath, 'icon.png')
          : path.join(app.getAppPath(), 'resources', 'icon.png');
        try {
          const data = fs.readFileSync(iconPath);
          return new Response(data, {
            headers: { 'Content-Type': 'image/png' }
          });
        } catch {
          return new Response('icon missing', { status: 404 });
        }
      }

      const id = parseInt(url.pathname.replace(/^\//, ''), 10);
      if (!Number.isFinite(id)) {
        return new Response('invalid id', { status: 400 });
      }
      const track = getTrack(id);
      if (!track) return new Response('track not found', { status: 404 });

      if (url.hostname === 'artwork') {
        const artwork = await getTrackEmbeddedArtwork(track);
        if (!artwork) return new Response('artwork not found', { status: 404 });
        return new Response(Buffer.from(artwork.data), {
          status: 200,
          headers: {
            'Content-Type': artwork.mimeType,
            'Cache-Control': 'public, max-age=3600'
          }
        });
      }

      const actualPath = resolveTrackFilePath(track);
      if (!actualPath) {
        return new Response('file missing on disk', { status: 404 });
      }

      const stat = fs.statSync(actualPath);
      const total = stat.size;
      const mime = mimeForExt(path.extname(actualPath));
      const rangeHeader = request.headers.get('range');

      if (rangeHeader) {
        const range = parseRange(rangeHeader, total);
        if (!range) {
          return new Response('invalid range', {
            status: 416,
            headers: {
              'Content-Range': `bytes */${total}`
            }
          });
        }
        const { start, end } = range;
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
      console.error('[FMusic-media] handler error:', err);
      return new Response('internal error', { status: 500 });
    }
  });
}

function createWindow(): void {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'resources', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    show: false,
    title: 'FMusic',
    icon: nativeImage.createFromPath(iconPath),
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#161a22',
      symbolColor: '#8d95a8',
      height: 32
    } : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send(Channels.WindowMaximizeChange, true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send(Channels.WindowMaximizeChange, false);
  });

  // Hide the mini player whenever the main window becomes visible again.
  mainWindow.on('show', () => {
    hideMiniPlayer();
  });

  // Intercept close: hide to tray or quit depending on user setting.
  // The mini player is shown here — and only here — so that focus loss
  // never accidentally triggers it.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      const { closeToTray, miniPlayerEnabled } = getSettings();
      if (closeToTray) {
        e.preventDefault();
        mainWindow?.hide();
        if (miniPlayerEnabled) showMiniPlayer();
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
            "img-src 'self' data: blob: https: file: fmusic-media:; " +
            "media-src 'self' blob: file: fmusic-media: https://*.googlevideo.com https://*.youtube.com; " +
            "frame-src https://www.youtube.com https://www.youtube-nocookie.com; " +
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
            "connect-src 'self' https: wss: fmusic-media:;"
        ]
      }
    });
  });
}

const isSingleInstance = app.requestSingleInstanceLock();

if (!isSingleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    try {
    getDb();
    ensureBuiltinPlaylists();
    cleanupMissingTracks();
    if (screenshotMode) {
      seedScreenshotDemoData(app.getPath('userData'));
    }

    // Start unified local server if any capability is enabled
    const s = getSettings();
    if (s.mobileSyncEnabled || s.remoteControllerEnabled || s.sonosEnabled) {
      void startUnifiedServer().catch(console.error);
    }
  } catch (err) {
    console.error('[FMusic] Failed to initialize library database:', err);
  }

  void warmTrackArtworkCache().catch((err) => {
    console.error('[FMusic] Failed to warm artwork cache:', err);
  });

  registerMediaProtocol();
  configureSecurity();
  registerIpc();
  createWindow();

  if (screenshotMode && mainWindow) {
    void runScreenshotCapture(mainWindow)
      .then(() => {
        isQuitting = true;
        app.quit();
      })
      .catch((err) => {
        console.error('[FMusic] Screenshot capture failed:', err);
        app.exit(1);
      });
  }

  // Create tray + mini player after window exists.
  // Left-click on tray: toggle mini player (show if hidden, hide if visible).
  if (!screenshotMode) {
    createTray(mainWindow!, () => {
      // The mini player is mutually exclusive with the main window:
      //  • Main visible → just bring it to the front. Never hide the main
      //    window or open the mini in its place — the mini is only meant
      //    for when the user has actively closed the main window.
      //  • Main hidden + mini enabled → toggle the mini's visibility.
      //  • Main hidden + mini disabled → restore the main window.
      if (mainWindow?.isVisible()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        return;
      }
      const { miniPlayerEnabled } = getSettings();
      if (!miniPlayerEnabled) {
        mainWindow?.show();
        mainWindow?.focus();
        return;
      }
      const mini = getMiniPlayer();
      if (!mini) return;
      if (mini.isVisible()) {
        mini.hide();
      } else {
        mini.show();
        mini.focus();
      }
    });
    createMiniPlayer();
  }
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

  // Mini player scrub → forward the seek value to the main renderer; the
  // TrayBridge there decides whether to apply it to the local Howl or to
  // the Sonos speaker when casting.
  ipcMain.on('mini:seek', (_evt, seconds: number) => {
    mainWindow?.webContents.send('mini:seek-from-main', seconds);
  });

  ipcMain.on('remote:state-from-main', (_evt, state: unknown) => {
    updateRemoteControllerSnapshot(state as Parameters<typeof updateRemoteControllerSnapshot>[0]);
  });

  setRemoteControllerCommandHandler((command) => {
    if (command.type === 'seek') {
      mainWindow?.webContents.send('remote:seek-from-main', command.seconds);
    } else if (command.type === 'volume') {
      mainWindow?.webContents.send('remote:volume-from-main', command.volume);
    } else {
      mainWindow?.webContents.send('remote:command', command);
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
  stopUnifiedServer();
  closeDb();
});
}
