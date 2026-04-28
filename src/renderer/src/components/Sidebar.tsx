import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useLibraryStore } from '../store/library';
import { useT, playlistDisplayName } from '../i18n';
import type { UpdateStatus } from '../../../shared/types';
import {
  DownloadIcon,
  LibraryIcon,
  PlaylistIcon,
  SettingsIcon,
  SparklesIcon
} from './icons';

const RELEASES_URL = 'https://github.com/dgarana/fmusic/releases/latest';
const GITHUB_URL = 'https://github.com/dgarana/fmusic';

export function Sidebar() {
  const playlists = useLibraryStore((s) => s.playlists);
  const t = useT();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle' });

  useEffect(() => {
    window.fmusic.getAppVersion().then(setAppVersion).catch(() => setAppVersion(null));
    window.fmusic.getUpdaterStatus().then(setUpdateStatus).catch(() => {});
    return window.fmusic.onUpdaterStatus(setUpdateStatus);
  }, []);

  return (
    <aside className="sidebar">
      <div
        className="brand"
        onClick={() => void window.fmusic.openExternal(GITHUB_URL)}
        title={t('nav.openGithub', { defaultValue: 'View on GitHub' })}
      >
        <img
          src="fmusic-media://app-icon"
          alt="FMusic"
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
        />
        {appVersion && <div className="brand-version">v{appVersion}</div>}
      </div>
      <nav>
        <NavLink to="/download" className={({ isActive }) => (isActive ? 'active' : '')}>
          <DownloadIcon size={16} />
          <span>{t('nav.download')}</span>
        </NavLink>
        <NavLink to="/library" className={({ isActive }) => (isActive ? 'active' : '')}>
          <LibraryIcon size={16} />
          <span>{t('nav.library')}</span>
        </NavLink>
        <NavLink to="/playlists" className={({ isActive }) => (isActive ? 'active' : '')}>
          <PlaylistIcon size={16} />
          <span>{t('nav.playlists')}</span>
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
          <SettingsIcon size={16} />
          <span>{t('nav.settings')}</span>
        </NavLink>
      </nav>
      <div className="playlists">
        <h3>{t('nav.yourPlaylists')}</h3>
        {playlists.length === 0 && <div className="empty">{t('nav.noPlaylistsYet')}</div>}
        {playlists.map((p) => (
          <NavLink
            key={p.id}
            to={`/playlists/${p.id}`}
            className={({ isActive }) => 'playlist-item' + (isActive ? ' active' : '')}
          >
            <span className="sidebar-playlist-label">
              <span>{playlistDisplayName(p, t)}</span>
              {p.kind === 'smart' && (
                <span className="sidebar-smart-marker" title={t('playlists.smart.badge')}>
                  <SparklesIcon size={11} />
                </span>
              )}
            </span>
            <span>{p.trackCount}</span>
          </NavLink>
        ))}
      </div>
      <div className="sidebar-footer">
        <UpdateBadge status={updateStatus} t={t} />
      </div>
    </aside>
  );
}

function UpdateBadge({ status, t }: { status: UpdateStatus; t: ReturnType<typeof useT> }) {
  if (status.status === 'available') {
    return (
      <button className="sidebar-update-link" onClick={() => void window.fmusic.downloadUpdate()}>
        {t('updater.available', { version: status.version })}
      </button>
    );
  }

  if (status.status === 'downloading') {
    return (
      <span className="text-muted">
        {t('updater.downloading', { percent: status.percent })}
      </span>
    );
  }

  if (status.status === 'ready') {
    return (
      <button
        className="sidebar-update-link fw-600"
        onClick={() => void window.fmusic.installUpdate()}
      >
        {t('updater.ready')}
      </button>
    );
  }

  if (status.status === 'error') {
    return (
      <span className="text-muted">
        {t('updater.error')}{' '}
        <button className="sidebar-update-link" onClick={() => void window.fmusic.openExternal(RELEASES_URL)}>
          {t('updater.downloadManually')}
        </button>
      </span>
    );
  }

  return null;
}
