import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/types.js';

let lastStatus: UpdateStatus = { status: 'idle' };

function broadcast(status: UpdateStatus): void {
  lastStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('updater:status', status);
    }
  }
}

export function getLastUpdaterStatus(): UpdateStatus {
  return lastStatus;
}

export function checkForUpdates(): void {
  if (!app.isPackaged) return;
  autoUpdater.checkForUpdates().catch((err) => {
    broadcast({ status: 'error', message: String(err.message ?? err) });
  });
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch((err) => {
    broadcast({ status: 'error', message: String(err.message ?? err) });
  });
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}

export function initUpdater(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    broadcast({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    broadcast({ status: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    broadcast({ status: 'up-to-date' });
  });

  autoUpdater.on('download-progress', (progress) => {
    broadcast({ status: 'downloading', percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    broadcast({ status: 'ready', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    broadcast({ status: 'error', message: String(err.message ?? err) });
  });

  // Delay initial check so the renderer has time to mount and subscribe.
  setTimeout(() => { checkForUpdates(); }, 3000);
}
