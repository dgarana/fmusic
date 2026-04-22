import { app, Menu, nativeImage, Tray, BrowserWindow } from 'electron';
import path from 'node:path';
import { t } from './i18n.js';

export interface TrayPlayerState {
  title: string | null;
  artist: string | null;
  isPlaying: boolean;
  hasPrev: boolean;
  hasNext: boolean;
}

let tray: Tray | null = null;
let currentState: TrayPlayerState = {
  title: null,
  artist: null,
  isPlaying: false,
  hasPrev: false,
  hasNext: false
};

function buildMenu(win: BrowserWindow, state: TrayPlayerState): Electron.Menu {
  const trackLabel = state.title
    ? `${state.title}${state.artist ? ` — ${state.artist}` : ''}`
    : t('tray.nothingPlaying');

  return Menu.buildFromTemplate([
    { label: trackLabel, enabled: false },
    { type: 'separator' },
    {
      label: state.isPlaying ? t('tray.pause') : t('tray.play'),
      enabled: state.title !== null,
      click: () => win.webContents.send('tray:command', 'toggle-play')
    },
    {
      label: t('tray.previous'),
      enabled: state.hasPrev,
      click: () => win.webContents.send('tray:command', 'prev')
    },
    {
      label: t('tray.next'),
      enabled: state.hasNext,
      click: () => win.webContents.send('tray:command', 'next')
    },
    { type: 'separator' },
    {
      label: t('tray.openFmusic'),
      click: () => { win.show(); win.focus(); }
    },
    {
      label: t('tray.quit'),
      click: () => app.quit()
    }
  ]);
}

let lastWin: BrowserWindow | null = null;

export function createTray(win: BrowserWindow, onLeftClick: () => void): void {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'resources', 'icon.png');

  const icon = nativeImage.createFromPath(iconPath).resize({ width: 22, height: 22 });
  
  tray = new Tray(icon);
  tray.setToolTip('FMusic');
  tray.on('click', onLeftClick);
  lastWin = win;
  updateTray(win, currentState);
}

export function updateTray(win: BrowserWindow, state: TrayPlayerState): void {
  if (!tray) return;
  currentState = state;
  lastWin = win;
  tray.setContextMenu(buildMenu(win, state));
  const tooltip = state.title
    ? `FMusic — ${state.title}${state.isPlaying ? ' ▶' : ' ⏸'}`
    : 'FMusic';
  tray.setToolTip(tooltip);
}

/** Re-translates the tray menu/tooltip using the current cached state. */
export function refreshTrayLanguage(): void {
  if (tray && lastWin) updateTray(lastWin, currentState);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
