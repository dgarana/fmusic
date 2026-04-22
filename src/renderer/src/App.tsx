import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { PlayerBar } from './components/PlayerBar';
import { TrayBridge } from './components/TrayBridge';
import { MobileBridge } from './components/MobileBridge';
import { WindowTitleBar } from './components/WindowTitleBar';
import { DownloadPage } from './pages/DownloadPage';
import { LibraryPage } from './pages/LibraryPage';
import { MiniPlayerPage } from './pages/MiniPlayerPage';
import { PlaylistsPage } from './pages/PlaylistsPage';
import { SettingsPage } from './pages/SettingsPage';
import { EditPage } from './pages/EditPage';
import { useLibraryStore } from './store/library';
import { useDownloadsStore } from './store/downloads';
import { usePlayerStore } from './store/player';
import { useSearchStore } from './store/search';
import { useSettingsStore } from './store/settings';
import { useSonosStore } from './store/sonos';
import type { DownloadJob, SearchResult } from '../../shared/types';

function demoThumbnail(label: string, colors: [string, string]): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${colors[0]}"/>
          <stop offset="100%" stop-color="${colors[1]}"/>
        </linearGradient>
      </defs>
      <rect width="640" height="360" fill="url(#g)" rx="28"/>
      <circle cx="540" cy="90" r="48" fill="rgba(255,255,255,0.16)"/>
      <text x="36" y="300" fill="white" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="700">${label}</text>
    </svg>
  `.trim();
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function App() {
  const refreshAll = useLibraryStore((s) => s.refreshAll);
  const handleTrackAdded = useLibraryStore((s) => s.handleTrackAdded);
  const refreshDownloads = useDownloadsStore((s) => s.refresh);
  const applyDownloadUpdate = useDownloadsStore((s) => s.applyUpdate);
  const loadSettings = useSettingsStore((s) => s.load);
  const settings = useSettingsStore((s) => s.settings);

  useEffect(() => {
    if (settings?.theme) {
      document.body.className = `theme-${settings.theme}`;
    } else {
      document.body.className = 'theme-original';
    }
  }, [settings?.theme]);

  useEffect(() => {
    void refreshAll();
    void refreshDownloads();
    void loadSettings();

    const offDownload = window.fmusic.onDownloadUpdate((job) => applyDownloadUpdate(job));
    const offTrack = window.fmusic.onTrackAdded((track) => handleTrackAdded(track));
    // Keep every window's settings store in sync: the main process
    // broadcasts Channels.SettingsChanged after any update, so the mini
    // player picks up theme/language changes made in the main window.
    const offSettings = window.fmusic.onSettingsChanged((next) => {
      useSettingsStore.setState({ settings: next });
    });
    return () => {
      offDownload();
      offTrack();
      offSettings();
    };
  }, [refreshAll, refreshDownloads, applyDownloadUpdate, handleTrackAdded]);

  useEffect(() => {
    const screenshotHelpers = {
      prepareDownloadsDemo: () => {
        const demoResults: SearchResult[] = [
          {
            id: 'demo-night-drive',
            title: 'Night Drive',
            channel: 'Cazzette',
            durationSec: 228,
            thumbnail: demoThumbnail('Night Drive', ['#0b1f3a', '#118ab2']),
            url: 'https://example.com/night-drive'
          },
          {
            id: 'demo-static-hearts',
            title: 'Static Hearts',
            channel: 'Dua Lipa',
            durationSec: 193,
            thumbnail: demoThumbnail('Static Hearts', ['#6d1f6d', '#ff4d6d']),
            url: 'https://example.com/static-hearts'
          },
          {
            id: 'demo-glass-horizon',
            title: 'Glass Horizon',
            channel: 'Rammstein',
            durationSec: 261,
            thumbnail: demoThumbnail('Glass Horizon', ['#1f2937', '#f97316']),
            url: 'https://example.com/glass-horizon'
          }
        ];
        const demoJobs: DownloadJob[] = [
          {
            id: 'job-1',
            request: { url: 'https://example.com/night-drive', format: 'mp3', quality: 192 },
            status: 'downloading',
            title: 'Night Drive',
            youtubeId: 'demo-night-drive',
            thumbnail: demoResults[0].thumbnail ?? undefined,
            progress: 0.62,
            etaSeconds: 18,
            speedHuman: '1.8MiB/s'
          },
          {
            id: 'job-2',
            request: { url: 'https://example.com/direct-url', format: 'mp3', quality: 192 },
            status: 'processing',
            title: 'Analog Bloom',
            youtubeId: 'demo-analog-bloom',
            progress: 0.94
          }
        ];
        useSearchStore.setState({
          query: 'demo soundtrack',
          results: demoResults,
          resultLimit: 12,
          error: null
        });
        useDownloadsStore.setState({ jobs: demoJobs });
      },
      preparePlaylistDownloadDemo: () => {
        const batchId = 'demo-playlist-import';
        const playlistTitle = 'Industrial Essentials';
        const playlistJobs: DownloadJob[] = [
          {
            id: 'pl-job-1',
            request: {
              url: 'https://www.youtube.com/watch?v=demo-du-hast',
              format: 'mp3',
              quality: 320,
              playlistId: 42,
              batchId,
              batchTitle: playlistTitle
            },
            status: 'completed',
            title: 'Du Hast',
            youtubeId: 'demo-du-hast',
            thumbnail: demoThumbnail('Du Hast', ['#111827', '#ef4444']),
            progress: 1,
            trackId: 101
          },
          {
            id: 'pl-job-2',
            request: {
              url: 'https://www.youtube.com/watch?v=demo-sonne',
              format: 'mp3',
              quality: 320,
              playlistId: 42,
              batchId,
              batchTitle: playlistTitle
            },
            status: 'downloading',
            title: 'Sonne',
            youtubeId: 'demo-sonne',
            thumbnail: demoThumbnail('Sonne', ['#312e81', '#f59e0b']),
            progress: 0.58,
            etaSeconds: 24,
            speedHuman: '2.4MiB/s'
          },
          {
            id: 'pl-job-3',
            request: {
              url: 'https://www.youtube.com/watch?v=demo-engel',
              format: 'mp3',
              quality: 320,
              playlistId: 42,
              batchId,
              batchTitle: playlistTitle
            },
            status: 'queued',
            title: 'Engel',
            youtubeId: 'demo-engel',
            thumbnail: demoThumbnail('Engel', ['#164e63', '#22d3ee']),
            progress: 0
          },
          {
            id: 'pl-job-4',
            request: {
              url: 'https://www.youtube.com/watch?v=demo-links',
              format: 'mp3',
              quality: 320,
              playlistId: 42,
              batchId,
              batchTitle: playlistTitle
            },
            status: 'processing',
            title: 'Links 2 3 4',
            youtubeId: 'demo-links',
            thumbnail: demoThumbnail('Links', ['#3f3f46', '#84cc16']),
            progress: 0.96
          }
        ];
        useSearchStore.setState({
          query: 'https://www.youtube.com/playlist?list=PL-industrial-demo',
          results: [],
          resultLimit: 12,
          error: null
        });
        useDownloadsStore.setState({ jobs: playlistJobs });
      },
      prepareSonosDemo: async () => {
        const tracks = await window.fmusic.listTracks();
        const current = tracks[0] ?? null;
        usePlayerStore.setState({
          current,
          queue: current ? tracks : [],
          index: current ? 0 : -1,
          isPlaying: true,
          position: 87,
          duration: current?.durationSec ?? 0
        });
        useSonosStore.setState({
          devices: [
            { name: 'Living Room', host: '192.168.1.23', port: 1400 },
            { name: 'Studio', host: '192.168.1.42', port: 1400 }
          ],
          activeHost: null,
          isPlaying: false,
          position: 87,
          duration: current?.durationSec ?? 0,
          discovering: false,
          error: null
        });
      }
    };

    (window as Window & { __fmusicScreenshot?: typeof screenshotHelpers }).__fmusicScreenshot =
      screenshotHelpers;

    return () => {
      delete (window as Window & { __fmusicScreenshot?: typeof screenshotHelpers }).__fmusicScreenshot;
    };
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route path="/miniplayer" element={<MiniPlayerPage />} />
        <Route
          path="*"
          element={
            <div className="app-shell">
              <WindowTitleBar />
              <TrayBridge />
              <MobileBridge />
              <Sidebar />
              <main className="main">
                <Routes>
                  <Route path="/" element={<Navigate to="/download" replace />} />
                  <Route path="/download" element={<DownloadPage />} />
                  <Route path="/library" element={<LibraryPage />} />
                  <Route path="/edit/:id" element={<EditPage />} />
                  <Route path="/playlists" element={<PlaylistsPage />} />
                  <Route path="/playlists/:id" element={<PlaylistsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Routes>
              </main>
              <PlayerBar />
            </div>
          }
        />
      </Routes>
    </HashRouter>
  );
}
