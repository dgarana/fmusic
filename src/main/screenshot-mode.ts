import { BrowserWindow, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import NodeID3 from 'node-id3';
import type { SmartPlaylistDefinition, Track } from '../shared/types.js';
import { updateSettings } from './settings.js';
import { getDb } from './library/db.js';
import {
  ensureBuiltinPlaylists,
  createPlaylist,
  createSmartPlaylist,
  addTrackToPlaylist,
  listPlaylists
} from './library/playlists-repo.js';
import { insertTrack } from './library/tracks-repo.js';
import {
  getRemoteControllerInfo
} from './remote-controller-server.js';
import { startUnifiedServer } from './server-manager.js';

export const screenshotMode = process.env.FMUSIC_SCREENSHOT_MODE === '1';
const screenshotOutputDir = process.env.FMUSIC_SCREENSHOT_OUTPUT_DIR ?? '';

interface DemoSeedResult {
  tracks: Track[];
  playlistIds: number[];
  smartPlaylistIds: number[];
}

let seededData: DemoSeedResult | null = null;

function svgCover(title: string, artist: string, colors: [string, string]): Buffer {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${colors[0]}"/>
          <stop offset="100%" stop-color="${colors[1]}"/>
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="44" fill="url(#bg)"/>
      <circle cx="406" cy="110" r="58" fill="rgba(255,255,255,0.16)"/>
      <circle cx="116" cy="406" r="86" fill="rgba(255,255,255,0.12)"/>
      <text x="42" y="364" fill="white" font-family="Segoe UI, Arial, sans-serif" font-size="46" font-weight="700">${title}</text>
      <text x="42" y="414" fill="rgba(255,255,255,0.86)" font-family="Segoe UI, Arial, sans-serif" font-size="24">${artist}</text>
      <text x="42" y="96" fill="rgba(255,255,255,0.72)" font-family="Segoe UI, Arial, sans-serif" font-size="20" letter-spacing="4">FMUSIC DEMO</text>
    </svg>
  `.trim();
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).toPNG();
}

function writeTaggedDemoMp3(filePath: string, title: string, artist: string, album: string, genre: string, artwork: Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.alloc(0));
  const result = NodeID3.write(
    {
      title,
      artist,
      album,
      genre,
      image: {
        mime: 'image/png',
        type: {
          id: NodeID3.TagConstants.AttachedPicture.PictureType.FRONT_COVER,
          name: 'front cover'
        },
        description: 'Album cover',
        imageBuffer: artwork
      }
    },
    filePath
  );
  if (result instanceof Error) {
    throw result;
  }
}

export function seedScreenshotDemoData(userDataDir: string): DemoSeedResult {
  if (seededData) return seededData;

  const db = getDb();
  db.exec('DELETE FROM playlist_tracks; DELETE FROM tracks; DELETE FROM playlists;');
  ensureBuiltinPlaylists();
  updateSettings({
    closeToTray: false,
    miniPlayerEnabled: false,
    sonosEnabled: false,
    language: 'en'
  });

  const mediaDir = path.join(userDataDir, 'demo-media');
  const demoTracks = [
    {
      title: 'Night Drive',
      artist: 'Cazzette',
      album: 'Outer Signals',
      genre: 'Electro House',
      durationSec: 228,
      youtubeId: 'demo-night-drive',
      colors: ['#0b1f3a', '#118ab2']
    },
    {
      title: 'Static Hearts',
      artist: 'Dua Lipa',
      album: 'Neon Echoes',
      genre: 'Pop',
      durationSec: 193,
      youtubeId: 'demo-static-hearts',
      colors: ['#6d1f6d', '#ff4d6d']
    },
    {
      title: 'Glass Horizon',
      artist: 'Rammstein',
      album: 'Titan Lines',
      genre: 'Industrial Metal',
      durationSec: 261,
      youtubeId: 'demo-glass-horizon',
      colors: ['#1f2937', '#f97316']
    },
    {
      title: 'Blue Circuit',
      artist: 'Pegboard Nerds',
      album: 'Voltage Bloom',
      genre: 'EDM',
      durationSec: 205,
      youtubeId: 'demo-blue-circuit',
      colors: ['#111827', '#22c55e']
    },
    {
      title: 'Afterlight',
      artist: 'Porter Robinson',
      album: 'Afterlight',
      genre: 'Electronic',
      durationSec: 244,
      youtubeId: 'demo-afterlight',
      colors: ['#1e1b4b', '#38bdf8']
    }
  ];

  const tracks = demoTracks.map((demo, index) => {
    const artwork = svgCover(demo.title, demo.artist, demo.colors as [string, string]);
    const filePath = path.join(mediaDir, `${String(index + 1).padStart(2, '0')} ${demo.artist} - ${demo.title}.mp3`);
    writeTaggedDemoMp3(filePath, demo.title, demo.artist, demo.album, demo.genre, artwork);
    return insertTrack({
      youtubeId: demo.youtubeId,
      title: demo.title,
      artist: demo.artist,
      album: demo.album,
      genre: demo.genre,
      durationSec: demo.durationSec,
      filePath,
      thumbnailPath: null,
      sourceUrl: null
    });
  });

  const synthwave = createPlaylist('Synthwave Mix');
  const gym = createPlaylist('Gym Rotation');
  addTrackToPlaylist(synthwave.id, tracks[0].id);
  addTrackToPlaylist(synthwave.id, tracks[1].id);
  addTrackToPlaylist(synthwave.id, tracks[4].id);
  addTrackToPlaylist(gym.id, tracks[2].id);
  addTrackToPlaylist(gym.id, tracks[3].id);

  const favorites = listPlaylists().find((playlist) => playlist.slug === 'favorites');
  if (favorites) {
    addTrackToPlaylist(favorites.id, tracks[0].id);
    addTrackToPlaylist(favorites.id, tracks[2].id);
  }

  const lateNightDefinition: SmartPlaylistDefinition = {
    match: 'any',
    rules: [
      {
        id: 'smart-demo-1',
        field: 'genre',
        operator: 'isAnyOf',
        value: { kind: 'text-list', values: ['Electronic', 'EDM', 'Electro House'] }
      },
      {
        id: 'smart-demo-2',
        field: 'artist',
        operator: 'contains',
        value: { kind: 'text', value: 'Porter' }
      }
    ]
  };
  const heavyDefinition: SmartPlaylistDefinition = {
    match: 'all',
    rules: [
      {
        id: 'smart-demo-3',
        field: 'genre',
        operator: 'contains',
        value: { kind: 'text', value: 'Metal' }
      }
    ]
  };

  const lateNight = createSmartPlaylist('Late Night Energy', lateNightDefinition);
  const heavy = createSmartPlaylist('Heavy Picks', heavyDefinition);

  seededData = {
    tracks,
    playlistIds: [synthwave.id, gym.id],
    smartPlaylistIds: [lateNight.id, heavy.id]
  };
  return seededData;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureRoute(win: BrowserWindow, hash: string, filename: string): Promise<void> {
  await win.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(hash)};`);
  await wait(900);
  const image = await win.capturePage();
  fs.mkdirSync(screenshotOutputDir, { recursive: true });
  fs.writeFileSync(path.join(screenshotOutputDir, filename), image.toPNG());
}

async function prepareDownloadsScreenshot(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(`(async () => {
    window.location.hash = '#/download';
    await new Promise((resolve) => setTimeout(resolve, 600));
    await window.__fmusicScreenshot?.prepareDownloadsDemo?.();
  })()`);
  await wait(900);
}

async function preparePlaylistDownloadScreenshot(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(`(async () => {
    window.location.hash = '#/download';
    await new Promise((resolve) => setTimeout(resolve, 600));
    await window.__fmusicScreenshot?.preparePlaylistDownloadDemo?.();
  })()`);
  await wait(900);
}

async function prepareSonosScreenshot(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(`(async () => {
    window.location.hash = '#/library';
    await new Promise((resolve) => setTimeout(resolve, 600));
    await window.__fmusicScreenshot?.prepareSonosDemo?.();
    await new Promise((resolve) => setTimeout(resolve, 300));
    document.querySelector('.sonos-btn')?.click();
  })()`);
  await wait(1000);
}

async function captureSmartPlaylistBuilder(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clickButton = (matcher) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const button = buttons.find((node) => matcher((node.textContent || '').trim()));
      if (!button) throw new Error('Button not found');
      button.click();
    };
    const setInputValue = (input, value) => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    window.location.hash = '#/playlists';
    await wait(700);
    clickButton((text) => text === 'Smart playlist');
    await wait(400);

    const nameInput = document.querySelector('.smart-playlist-panel input');
    if (!(nameInput instanceof HTMLInputElement)) {
      throw new Error('Smart playlist name input not found');
    }
    setInputValue(nameInput, 'Late Night Energy');
    await wait(150);

    clickButton((text) => text === 'genre');
    await wait(120);
    clickButton((text) => text === 'is any of');
    await wait(120);

    const tokenInput = document.querySelector('.smart-token-input');
    if (!(tokenInput instanceof HTMLInputElement)) {
      throw new Error('Smart playlist token input not found');
    }
    setInputValue(tokenInput, 'Electronic');
    await wait(120);
    clickButton((text) => text === 'Electronic');
    await wait(120);

    setInputValue(tokenInput, 'EDM');
    await wait(120);
    clickButton((text) => text.includes('Add "EDM"'));
    await wait(120);
    clickButton((text) => text.includes('Finish this filter'));
    await wait(180);

    clickButton((text) => text === 'artist');
    await wait(120);
    clickButton((text) => text === 'contains');
    await wait(120);
    setInputValue(tokenInput, 'Porter');
    await wait(120);
    clickButton((text) => text.includes('Use "Porter"'));
    await wait(350);
  })()`);
  await wait(900);
  const image = await win.capturePage();
  fs.writeFileSync(path.join(screenshotOutputDir, 'smart-playlist-builder.png'), image.toPNG());
}

/**
 * Navigate Settings → Network, enable the Remote Controller toggle, wait for
 * the server to start + the QR to render and capture the whole pane including
 * the BETA notice.
 */
async function captureRemoteControllerSettings(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(`(async () => {
    window.location.hash = '#/settings';
    await new Promise((resolve) => setTimeout(resolve, 500));
    const tabs = Array.from(document.querySelectorAll('.pill-tab'));
    const networkTab = tabs.find((b) => /network|red/i.test(b.textContent || ''));
    if (networkTab) networkTab.click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const labels = Array.from(document.querySelectorAll('label'));
    for (const label of labels) {
      if (/remote controller/i.test(label.textContent || '')) {
        const cb = label.querySelector('input[type="checkbox"]');
        if (cb && !cb.checked) cb.click();
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1400));
    document.querySelector('.remote-controller-settings')?.scrollIntoView({ block: 'start' });
  })()`);
  await wait(1500);
  const image = await win.capturePage();
  fs.writeFileSync(path.join(screenshotOutputDir, 'remote-controller-settings.png'), image.toPNG());
}

/**
 * Boot the remote controller server, open its web UI in a mobile-sized hidden
 * BrowserWindow and screenshot the Player tab with an active track so the
 * BETA notice, the equalizer highlight and the translated chrome are all
 * visible. Returns without throwing when the server cannot be reached so a
 * local screenshot run never hard-fails.
 */
async function captureRemoteControllerMobile(win: BrowserWindow): Promise<void> {
  // The main window drives playback; seeding the Sonos demo flips the player
  // store into isPlaying:true for the first seeded track, which is then
  // forwarded to the remote server via TrayBridge's sendRemoteState effect.
  await win.webContents.executeJavaScript(`(async () => {
    await window.__fmusicScreenshot?.prepareSonosDemo?.();
  })()`);
  await wait(1000);

  try {
    updateSettings({ remoteControllerEnabled: true });
    await startUnifiedServer();
  } catch (err) {
    console.warn('[screenshot] Could not start unified server for remote controller:', err);
    return;
  }
  const info = getRemoteControllerInfo();
  if (!info.url) {
    console.warn('[screenshot] Remote controller URL unavailable; skipping mobile capture.');
    return;
  }

  // Rewrite the LAN host to localhost so the capture works regardless of the
  // network state on the machine running the script.
  let localUrl: string;
  try {
    const parsed = new URL(info.url);
    parsed.hostname = 'localhost';
    localUrl = parsed.toString();
  } catch {
    localUrl = info.url;
  }

  const mobile = new BrowserWindow({
    width: 390,
    height: 810,
    useContentSize: true,
    show: true,
    frame: false,
    backgroundColor: '#101216',
    title: 'FMusic Remote (mobile)',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mobile.setMenuBarVisibility(false);
  try {
    await mobile.loadURL(localUrl);
    // Give the websocket handshake + initial state/data + applyI18n enough
    // time to settle before grabbing the pixels.
    await wait(2800);
    const image = await mobile.capturePage();
    fs.writeFileSync(
      path.join(screenshotOutputDir, 'remote-controller-mobile.png'),
      image.toPNG()
    );
  } catch (err) {
    console.warn('[screenshot] Mobile remote capture failed:', err);
  } finally {
    mobile.destroy();
  }
}

export async function runScreenshotCapture(win: BrowserWindow): Promise<void> {
  if (!screenshotMode) return;
  if (!screenshotOutputDir) {
    throw new Error('FMUSIC_SCREENSHOT_OUTPUT_DIR is required in screenshot mode.');
  }

  win.setSize(1440, 960);
  win.center();
  await wait(1400);
  await prepareDownloadsScreenshot(win);
  const downloadsImage = await win.capturePage();
  fs.writeFileSync(path.join(screenshotOutputDir, 'downloads.png'), downloadsImage.toPNG());
  await preparePlaylistDownloadScreenshot(win);
  const playlistDownloadImage = await win.capturePage();
  fs.writeFileSync(
    path.join(screenshotOutputDir, 'playlist-download.png'),
    playlistDownloadImage.toPNG()
  );
  await captureRoute(win, '#/library', 'library.png');
  await prepareSonosScreenshot(win);
  const sonosImage = await win.capturePage();
  fs.writeFileSync(path.join(screenshotOutputDir, 'sonos.png'), sonosImage.toPNG());
  await captureRoute(win, '#/playlists', 'playlists.png');
  await captureSmartPlaylistBuilder(win);
  if (seededData?.playlistIds[0]) {
    await captureRoute(win, `#/playlists/${seededData.playlistIds[0]}`, 'playlist-detail.png');
  }
  if (seededData?.smartPlaylistIds[0]) {
    await captureRoute(
      win,
      `#/playlists/${seededData.smartPlaylistIds[0]}`,
      'smart-playlist-detail.png'
    );
  }
  await captureRoute(win, '#/settings', 'settings.png');

  // Mobile Sync screenshot
  await win.webContents.executeJavaScript(`(async () => {
    // 1. Enable Mobile Sync in settings first
    window.location.hash = '#/settings';
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    // Find and click Network tab
    const tabs = Array.from(document.querySelectorAll('button'));
    const networkTab = tabs.find(b => b.textContent.includes('Network') || b.textContent.includes('Red'));
    if (networkTab) networkTab.click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    // Find and enable Mobile Sync toggle (it's the 3rd one in the network tab)
    const toggles = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    if (toggles[2] && !toggles[2].checked) toggles[2].click();
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 2. Go to library and click the mobile sync button for a track
    window.location.hash = '#/library';
    await new Promise((resolve) => setTimeout(resolve, 800));
    const mobileSyncBtns = Array.from(document.querySelectorAll('button')).filter(b => {
      const title = b.getAttribute('title') || '';
      return title.toLowerCase().includes('mobile') || title.toLowerCase().includes('móvil');
    });
    if (mobileSyncBtns[0]) mobileSyncBtns[0].click();
  })()`);
  await wait(1500);
  const mobileSyncImage = await win.capturePage();
  fs.writeFileSync(path.join(screenshotOutputDir, 'mobile-sync.png'), mobileSyncImage.toPNG());

  if (seededData?.tracks[0]) {
    await win.webContents.executeJavaScript(`(async () => {
      window.location.hash = '#/edit/${seededData.tracks[0].id}';
      await new Promise((resolve) => setTimeout(resolve, 600));
      await window.__fmusicScreenshot?.prepareSonosDemo?.(); // Use this to start playback for visual effect
    })()`);
    await wait(1200);
    const editImage = await win.capturePage();
    fs.writeFileSync(path.join(screenshotOutputDir, 'edit.png'), editImage.toPNG());
  }

  // Remote Controller (BETA): capture the desktop settings pane (toggle +
  // QR + BETA notice) and then the same controller rendered in a
  // mobile-sized BrowserWindow so the README can showcase both sides.
  await captureRemoteControllerSettings(win);
  await captureRemoteControllerMobile(win);
}
