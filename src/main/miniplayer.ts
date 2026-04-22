import { BrowserWindow } from 'electron';
import path from 'node:path';

let miniWin: BrowserWindow | null = null;

export function createMiniPlayer(): BrowserWindow {
  miniWin = new BrowserWindow({
    width: 340,
    height: 120,
    minWidth: 340,
    maxWidth: 340,
    minHeight: 120,
    maxHeight: 120,
    frame: false,
    // A transparent native background lets the CSS theme (light, dark,
    // darcula) drive the look instead of a hardcoded color that would peek
    // through during load / on light themes.
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (devServer) {
    void miniWin.loadURL(`${devServer}#/miniplayer`);
  } else {
    void miniWin.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: 'miniplayer'
    });
  }

  miniWin.on('closed', () => {
    miniWin = null;
  });

  return miniWin;
}

export function showMiniPlayer(): void {
  miniWin?.show();
}

export function hideMiniPlayer(): void {
  miniWin?.hide();
}

export function getMiniPlayer(): BrowserWindow | null {
  return miniWin;
}
