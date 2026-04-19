import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { PlayerBar } from './components/PlayerBar';
import { TrayBridge } from './components/TrayBridge';
import { DownloadPage } from './pages/DownloadPage';
import { LibraryPage } from './pages/LibraryPage';
import { MiniPlayerPage } from './pages/MiniPlayerPage';
import { PlaylistsPage } from './pages/PlaylistsPage';
import { SettingsPage } from './pages/SettingsPage';
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

  useEffect(() => {
    void refreshAll();
    void refreshDownloads();
    void loadSettings();

    const offDownload = window.fmusic.onDownloadUpdate((job) => applyDownloadUpdate(job));
    const offTrack = window.fmusic.onTrackAdded((track) => handleTrackAdded(track));
    return () => {
      offDownload();
      offTrack();
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
              <TrayBridge />
              <Sidebar />
              <main className="main">
                <Routes>
                  <Route path="/" element={<Navigate to="/download" replace />} />
                  <Route path="/download" element={<DownloadPage />} />
                  <Route path="/library" element={<LibraryPage />} />
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
