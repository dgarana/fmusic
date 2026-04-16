import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLibraryStore } from '../store/library';
import { usePlayerStore } from '../store/player';
import { formatDuration } from '../util';
import type { Track } from '../../../shared/types';

export function PlaylistsPage() {
  const params = useParams();
  const { playlists, refreshPlaylists } = useLibraryStore();
  const [newName, setNewName] = useState('');

  const activeId = params.id ? Number(params.id) : null;
  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === activeId) ?? null,
    [playlists, activeId]
  );

  async function createPlaylist() {
    const name = newName.trim();
    if (!name) return;
    await window.fmusic.createPlaylist(name);
    setNewName('');
    await refreshPlaylists();
  }

  if (activePlaylist) {
    return <PlaylistDetail id={activePlaylist.id} name={activePlaylist.name} />;
  }

  return (
    <div>
      <h1>Playlists</h1>
      <div className="search-row">
        <input
          placeholder="Nombre de la nueva playlist..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void createPlaylist();
          }}
        />
        <button className="primary" onClick={() => void createPlaylist()}>
          Crear playlist
        </button>
      </div>

      {playlists.length === 0 ? (
        <div className="empty">Aún no tienes playlists.</div>
      ) : (
        <div className="results-grid">
          {playlists.map((p) => (
            <div key={p.id} className="result-card" style={{ padding: 16 }}>
              <div className="title" style={{ fontSize: 16 }}>
                {p.name}
              </div>
              <div className="channel">{p.trackCount} canciones</div>
              <div className="actions" style={{ marginTop: 10 }}>
                <a href={`#/playlists/${p.id}`}>
                  <button>Abrir</button>
                </a>
                <button
                  className="danger"
                  onClick={async () => {
                    if (!confirm(`¿Eliminar playlist "${p.name}"?`)) return;
                    await window.fmusic.deletePlaylist(p.id);
                    await refreshPlaylists();
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlaylistDetail({ id, name }: { id: number; name: string }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const refreshPlaylists = useLibraryStore((s) => s.refreshPlaylists);

  async function refresh() {
    const list = await window.fmusic.listTracks({ playlistId: id });
    setTracks(list);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function remove(trackId: number) {
    await window.fmusic.removeTrackFromPlaylist(id, trackId);
    await refresh();
    await refreshPlaylists();
  }

  async function moveUp(index: number) {
    if (index === 0) return;
    const ordered = [...tracks];
    [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]];
    setTracks(ordered);
    await window.fmusic.reorderPlaylist(id, ordered.map((t) => t.id));
  }

  return (
    <div>
      <h1>{name}</h1>
      {tracks.length === 0 ? (
        <div className="empty">
          Esta playlist está vacía. Añade canciones desde la Biblioteca.
        </div>
      ) : (
        <table className="track-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Título</th>
              <th>Artista</th>
              <th>Duración</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t, i) => (
              <tr key={t.id}>
                <td>{i + 1}</td>
                <td>{t.title}</td>
                <td>{t.artist ?? '-'}</td>
                <td>{formatDuration(t.durationSec)}</td>
                <td className="actions">
                  <button onClick={() => void playTrack(t, tracks)} title="Reproducir">▶</button>{' '}
                  <button onClick={() => void moveUp(i)} disabled={i === 0} title="Subir">↑</button>{' '}
                  <button className="danger" onClick={() => void remove(t.id)} title="Quitar">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
