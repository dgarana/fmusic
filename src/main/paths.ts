import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Resolves the directory holding our bundled binaries.
 * - In dev: <projectRoot>/resources/bin
 * - In prod: <process.resourcesPath>/bin
 */
export function binDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin');
  }
  return path.join(app.getAppPath(), 'resources', 'bin');
}

export function ytDlpPath(): string {
  const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  return path.join(binDir(), name);
}

export function ffmpegPath(): string {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return path.join(binDir(), name);
}

export function hasYtDlp(): boolean {
  try {
    return fs.existsSync(ytDlpPath());
  } catch {
    return false;
  }
}

export function hasFfmpeg(): boolean {
  try {
    return fs.existsSync(ffmpegPath());
  } catch {
    return false;
  }
}

export function userDataDir(): string {
  return app.getPath('userData');
}

export function libraryDbPath(): string {
  return path.join(userDataDir(), 'library.sqlite');
}

export function backupsDir(): string {
  const dir = path.join(userDataDir(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Default music directory used for downloads. `~/Music/FMusic`.
 */
export function defaultMusicDir(): string {
  const musicRoot = app.getPath('music');
  const dir = path.join(musicRoot, 'fmusic');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
