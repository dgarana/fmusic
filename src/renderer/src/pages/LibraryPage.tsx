import { useEffect, useMemo, useState } from 'react';
import { useLibraryStore } from '../store/library';
import { usePlayerStore } from '../store/player';
import { formatDuration } from '../util';
import type { Track, TrackSortKey } from '../../../shared/types';

const COLUMNS: Array<{ key: TrackSortKey; label: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'genre', label: 'Genre' },
  { key: 'durationSec', label: 'Duration' },
  { key: 'downloadedAt', label: 'Downloaded' }
];

export function LibraryPage() {
  const { tracks, genres, query, setQuery } = useLibraryStore();
  const playTrack = usePlayerStore((s) => s.playTrack);
  const [addingTrackId, setAddingTrackId] = useState<number | null>(null);
  const playlists = useLibraryStore((s) => s.playlists);
  const refreshPlaylists = useLibraryStore((s) => s.refreshPlaylists);
  const refreshTracks = useLibraryStore((s) => s.refreshTracks);
  const [playlistsByTrack, setPlaylistsByTrack] = useState<Map<number, number[]>>(new Map());

  const playlistsById = useMemo(() => {
    const map = new Map<number, string>();
    playlists.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [playlists]);

  useEffect(() => {
    if (tracks.length === 0) {
      setPlaylistsByTrack(new Map());
      return;
    }
    let cancelled = false;
    void window.fmusic
      .playlistsForTracks(tracks.map((t) => t.id))
      .then((map) => {
        if (!cancelled) setPlaylistsByTrack(map);
      });
    return () => {
      cancelled = true;
    };
  }, [tracks, playlists]);

  function sortBy(key: TrackSortKey) {
    const sortDir =
      query.sortBy === key ? (query.sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
    void setQuery({ sortBy: key, sortDir });
  }

  async function handleDelete(t: Track) {
    const ok = confirm(`Remove "${t.title}" from the library?`);
    if (!ok) return;
    const alsoFile = confirm('Also delete the file from disk?');
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
      <h1>📚 Library</h1>
      <div className="library-toolbar">
        <input
          placeholder="🔍 Search by title, artist, album or genre..."
          value={query.search ?? ''}
          onChange={(e) => void setQuery({ search: e.target.value })}
          style={{ flex: 1 }}
        />
        <select
          value={query.genre ?? ''}
          onChange={(e) => void setQuery({ genre: e.target.value || undefined })}
        >
          <option value="">All genres</option>
          {genres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      {tracks.length === 0 ? (
        <div className="empty">
          📦 Your library is empty. Download your first song from the Download tab.
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
              <th>Playlists</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => {
              const trackPlaylists = (playlistsByTrack.get(t.id) ?? [])
                .map((id) => playlistsById.get(id))
                .filter((name): name is string => Boolean(name));
              return (
              <tr key={t.id}>
                <td>{t.title}</td>
                <td>{t.artist ?? '-'}</td>
                <td>{t.album ?? '-'}</td>
                <td>{t.genre ?? '-'}</td>
                <td>{formatDuration(t.durationSec)}</td>
                <td>{t.downloadedAt.slice(0, 10)}</td>
                <td>
                  {trackPlaylists.length === 0 ? (
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {trackPlaylists.map((name) => (
                        <span key={name} className="status-pill" title={name}>
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="actions">
                  <button onClick={() => void playTrack(t, tracks)} title="Play">▶</button>{' '}
                  <button
                    onClick={() =>
                      setAddingTrackId(addingTrackId === t.id ? null : t.id)
                    }
                    title="Add to playlist"
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
                        Choose playlist...
                      </option>
                      {playlists.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}{' '}
                  <button className="danger" onClick={() => void handleDelete(t)} title="Delete">
                    ×
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
