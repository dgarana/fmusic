import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useLibraryStore } from '../store/library';
import { useT, playlistDisplayName } from '../i18n';
import type { UpdateStatus } from '../../../shared/types';

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
        style={{ position: 'relative', cursor: 'pointer' }}
        onClick={() => void window.fmusic.openExternal(GITHUB_URL)}
        title={t('nav.openGithub', { defaultValue: 'View on GitHub' })}
      >
        {appVersion && (
          <div
            style={{
              position: 'absolute',
              bottom: 24,
              right: 12,
              fontSize: 11,
              color: 'rgba(255,255,255,0.5)',
              fontWeight: 700,
              pointerEvents: 'none',
              zIndex: 1,
              textShadow: '0 1px 2px rgba(0,0,0,0.4)'
            }}
          >
            v{appVersion}
          </div>
        )}
        <img src="fmusic-media://app-icon" alt="FMusic" />
      </div>
      <nav>
        <NavLink to="/download" className={({ isActive }) => (isActive ? 'active' : '')}>
          {t('nav.download')}
        </NavLink>
        <NavLink to="/library" className={({ isActive }) => (isActive ? 'active' : '')}>
          {t('nav.library')}
        </NavLink>
        <NavLink to="/playlists" className={({ isActive }) => (isActive ? 'active' : '')}>
          {t('nav.playlists')}
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
          {t('nav.settings')}
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
            <span>{playlistDisplayName(p, t)}</span>
            <span style={{ color: 'var(--text-muted)' }}>{p.trackCount}</span>
          </NavLink>
        ))}
      </div>
      <div style={{ padding: '8px 16px', marginTop: 'auto', fontSize: 11 }}>
        <UpdateBadge status={updateStatus} t={t} />
      </div>
    </aside>
  );
}

function UpdateBadge({ status, t }: { status: UpdateStatus; t: ReturnType<typeof useT> }) {
  const linkStyle: React.CSSProperties = {
    color: 'var(--accent)',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: 11,
    textDecoration: 'underline'
  };

  if (status.status === 'available') {
    return (
      <button style={linkStyle} onClick={() => void window.fmusic.downloadUpdate()}>
        {t('updater.available', { version: status.version })}
      </button>
    );
  }

  if (status.status === 'downloading') {
    return (
      <span style={{ color: 'var(--text-muted)' }}>
        {t('updater.downloading', { percent: status.percent })}
      </span>
    );
  }

  if (status.status === 'ready') {
    return (
      <button
        style={{ ...linkStyle, fontWeight: 600 }}
        onClick={() => void window.fmusic.installUpdate()}
      >
        {t('updater.ready')}
      </button>
    );
  }

  if (status.status === 'error') {
    return (
      <span style={{ color: 'var(--text-muted)' }}>
        {t('updater.error')}{' '}
        <button style={linkStyle} onClick={() => void window.fmusic.openExternal(RELEASES_URL)}>
          {t('updater.downloadManually')}
        </button>
      </span>
    );
  }

  return null;
}
