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
import { useSettingsStore } from './store/settings';

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
