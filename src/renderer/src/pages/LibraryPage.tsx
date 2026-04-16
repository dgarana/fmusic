import { useState } from 'react';
import { useLibraryStore } from '../store/library';
import { usePlayerStore } from '../store/player';
import { formatDuration } from '../util';
import type { Track, TrackSortKey } from '../../../shared/types';

const COLUMNS: Array<{ key: TrackSortKey; label: string }> = [
  { key: 'title', label: 'Título' },
  { key: 'artist', label: 'Artista' },
  { key: 'album', label: 'Álbum' },
  { key: 'genre', label: 'Género' },
  { key: 'durationSec', label: 'Duración' },
  { key: 'downloadedAt', label: 'Descargada' }
];

export function LibraryPage() {
  const { tracks, genres, query, setQuery } = useLibraryStore();
  const playTrack = usePlayerStore((s) => s.playTrack);
  const [addingTrackId, setAddingTrackId] = useState<number | null>(null);
  const playlists = useLibraryStore((s) => s.playlists);
  const refreshPlaylists = useLibraryStore((s) => s.refreshPlaylists);
  const refreshTracks = useLibraryStore((s) => s.refreshTracks);

  function sortBy(key: TrackSortKey) {
    const sortDir =
      query.sortBy === key ? (query.sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
    void setQuery({ sortBy: key, sortDir });
  }

  async function handleDelete(t: Track) {
    const ok = confirm(`¿Eliminar "${t.title}" de la biblioteca?`);
    if (!ok) return;
    const alsoFile = confirm('¿También eliminar el archivo del disco?');
    await window.fmusic.deleteTrack(t.id, alsoFile);
    await refreshTracks();
  }

  async function handleAddToPlaylist(track: Track, playlistId: number) {
    await window.fmusic.addTrackToPlaylist(playlistId, track.id);
    setAddingTrackId(null);
    await refreshPlaylists();
  }

  return (
    <div>
      <h1>Biblioteca</h1>
      <div className="library-toolbar">
        <input
          placeholder="Buscar por título, artista, álbum o género..."
          value={query.search ?? ''}
          onChange={(e) => void setQuery({ search: e.target.value })}
          style={{ flex: 1 }}
        />
        <select
          value={query.genre ?? ''}
          onChange={(e) => void setQuery({ genre: e.target.value || undefined })}
        >
          <option value="">Todos los géneros</option>
          {genres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      {tracks.length === 0 ? (
        <div className="empty">
          Tu biblioteca está vacía. Descarga tu primera canción desde la pestaña Descargar.
        </div>
      ) : (
        <table className="track-table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key} onClick={() => sortBy(col.key)}>
                  {col.label}
                  {query.sortBy === col.key && (query.sortDir === 'asc' ? ' ▲' : ' ▼')}
                </th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => (
              <tr key={t.id}>
                <td>{t.title}</td>
                <td>{t.artist ?? '-'}</td>
                <td>{t.album ?? '-'}</td>
                <td>{t.genre ?? '-'}</td>
                <td>{formatDuration(t.durationSec)}</td>
                <td>{t.downloadedAt.slice(0, 10)}</td>
                <td className="actions">
                  <button onClick={() => void playTrack(t, tracks)} title="Reproducir">▶</button>{' '}
                  <button
                    onClick={() =>
                      setAddingTrackId(addingTrackId === t.id ? null : t.id)
                    }
                    title="Añadir a playlist"
                  >
                    +
                  </button>
                  {addingTrackId === t.id && (
                    <select
                      autoFocus
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        if (id) void handleAddToPlaylist(t, id);
                      }}
                      defaultValue=""
                      style={{ marginLeft: 6 }}
                    >
                      <option value="" disabled>
                        Elige playlist...
                      </option>
                      {playlists.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}{' '}
                  <button className="danger" onClick={() => void handleDelete(t)} title="Eliminar">
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
