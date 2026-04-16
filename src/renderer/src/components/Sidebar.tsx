import { NavLink } from 'react-router-dom';
import { useLibraryStore } from '../store/library';

export function Sidebar() {
  const playlists = useLibraryStore((s) => s.playlists);

  return (
    <aside className="sidebar">
      <div className="brand">fmusic</div>
      <nav>
        <NavLink to="/download" className={({ isActive }) => (isActive ? 'active' : '')}>
          Descargar
        </NavLink>
        <NavLink to="/library" className={({ isActive }) => (isActive ? 'active' : '')}>
          Biblioteca
        </NavLink>
        <NavLink to="/playlists" className={({ isActive }) => (isActive ? 'active' : '')}>
          Playlists
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
          Ajustes
        </NavLink>
      </nav>
      <div className="playlists">
        <h3>Tus playlists</h3>
        {playlists.length === 0 && <div className="empty">Aún no hay playlists</div>}
        {playlists.map((p) => (
          <NavLink
            key={p.id}
            to={`/playlists/${p.id}`}
            className={({ isActive }) =>
              'playlist-item' + (isActive ? ' active' : '')
            }
          >
            <span>{p.name}</span>
            <span style={{ color: 'var(--text-muted)' }}>{p.trackCount}</span>
          </NavLink>
        ))}
      </div>
    </aside>
  );
}
