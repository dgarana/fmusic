import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useLibraryStore } from '../store/library';
import { useT, playlistDisplayName } from '../i18n';

export function Sidebar() {
  const playlists = useLibraryStore((s) => s.playlists);
  const t = useT();
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    window.fmusic.getAppVersion().then(setAppVersion).catch(() => setAppVersion(null));
  }, []);

  return (
    <aside className="sidebar">
      <div className="brand">fmusic</div>
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
            className={({ isActive }) =>
              'playlist-item' + (isActive ? ' active' : '')
            }
          >
            <span>{playlistDisplayName(p, t)}</span>
            <span style={{ color: 'var(--text-muted)' }}>{p.trackCount}</span>
          </NavLink>
        ))}
      </div>
      {appVersion && (
        <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: '12px 16px', marginTop: 'auto' }}>
          v{appVersion}
        </div>
      )}
    </aside>
  );
}
