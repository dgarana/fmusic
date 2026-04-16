import { app, Menu, nativeImage, Tray, BrowserWindow } from 'electron';
import zlib from 'node:zlib';
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

/** Generates a solid-color 16x16 PNG buffer without external dependencies. */
function makePng(r: number, g: number, b: number): Buffer {
  const W = 16, H = 16;
  // Raw scanlines: one filter byte (0x00 = None) + W*3 RGB bytes per row
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const base = y * (1 + W * 3);
    raw[base] = 0;
    for (let x = 0; x < W; x++) {
      raw[base + 1 + x * 3] = r;
      raw[base + 1 + x * 3 + 1] = g;
      raw[base + 1 + x * 3 + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);

  function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type: string, data: Buffer): Buffer {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit depth, RGB

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function buildIcon(): Electron.NativeImage {
  // Purple #7c3aed
  return nativeImage.createFromBuffer(makePng(124, 58, 237));
}

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
  tray = new Tray(buildIcon());
  tray.setToolTip('fmusic');
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
    ? `fmusic — ${state.title}${state.isPlaying ? ' ▶' : ' ⏸'}`
    : 'fmusic';
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
