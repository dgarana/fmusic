import { useEffect, useMemo, useState } from 'react';
import { useLibraryStore } from '../store/library';
import { usePlayerStore } from '../store/player';
import { formatDuration } from '../util';
import { useT, playlistDisplayName } from '../i18n';
import type { Track, TrackSortKey } from '../../../shared/types';

export function LibraryPage() {
  const t = useT();
  const columns: Array<{ key: TrackSortKey; label: string }> = [
    { key: 'title', label: t('library.columns.title') },
    { key: 'artist', label: t('library.columns.artist') },
    { key: 'album', label: t('library.columns.album') },
    { key: 'genre', label: t('library.columns.genre') },
    { key: 'durationSec', label: t('library.columns.duration') },
    { key: 'downloadedAt', label: t('library.columns.downloaded') }
  ];
  const { tracks, genres, query, setQuery } = useLibraryStore();
  const playTrack = usePlayerStore((s) => s.playTrack);
  const [addingTrackId, setAddingTrackId] = useState<number | null>(null);
  const playlists = useLibraryStore((s) => s.playlists);
  const refreshPlaylists = useLibraryStore((s) => s.refreshPlaylists);
  const refreshTracks = useLibraryStore((s) => s.refreshTracks);
  const [playlistsByTrack, setPlaylistsByTrack] = useState<Map<number, number[]>>(new Map());

  const playlistsById = useMemo(() => {
    const map = new Map<number, string>();
    playlists.forEach((p) => map.set(p.id, playlistDisplayName(p, t)));
    return map;
  }, [playlists, t]);

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

  async function handleDelete(track: Track) {
    const ok = confirm(t('library.deleteConfirm', { title: track.title }));
    if (!ok) return;
    const alsoFile = confirm(t('library.alsoDeleteFile'));
    await window.fmusic.deleteTrack(track.id, alsoFile);
    await refreshTracks();
  }

  async function handleAddToPlaylist(track: Track, playlistId: number) {
    await window.fmusic.addTrackToPlaylist(playlistId, track.id);
    setAddingTrackId(null);
    await refreshPlaylists();
  }

  return (
    <div>
      <h1>{t('library.title')}</h1>
      <div className="library-toolbar">
        <input
          placeholder={t('library.searchPlaceholder')}
          value={query.search ?? ''}
          onChange={(e) => void setQuery({ search: e.target.value })}
          style={{ flex: 1 }}
        />
        <select
          value={query.genre ?? ''}
          onChange={(e) => void setQuery({ genre: e.target.value || undefined })}
        >
          <option value="">{t('library.allGenres')}</option>
          {genres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      {tracks.length === 0 ? (
        <div className="empty">
          {t('library.empty')}
        </div>
      ) : (
        <table className="track-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} onClick={() => sortBy(col.key)}>
                  {col.label}
                  {query.sortBy === col.key && (query.sortDir === 'asc' ? ' ▲' : ' ▼')}
                </th>
              ))}
              <th>{t('library.columns.playlists')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((tr) => {
              const trackPlaylists = (playlistsByTrack.get(tr.id) ?? [])
                .map((id) => playlistsById.get(id))
                .filter((name): name is string => Boolean(name));
              return (
              <tr key={tr.id}>
                <td>{tr.title}</td>
                <td>{tr.artist ?? '-'}</td>
                <td>{tr.album ?? '-'}</td>
                <td>{tr.genre ?? '-'}</td>
                <td>{formatDuration(tr.durationSec)}</td>
                <td>{tr.downloadedAt.slice(0, 10)}</td>
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
                  <button onClick={() => void playTrack(tr, tracks)} title={t('library.playTooltip')}>▶</button>{' '}
                  <button
                    onClick={() =>
                      setAddingTrackId(addingTrackId === tr.id ? null : tr.id)
                    }
                    title={t('library.addToPlaylistTooltip')}
                  >
                    +
                  </button>
                  {addingTrackId === tr.id && (
                    <select
                      autoFocus
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        if (id) void handleAddToPlaylist(tr, id);
                      }}
                      defaultValue=""
                      style={{ marginLeft: 6 }}
                    >
                      <option value="" disabled>
                        {t('library.choosePlaylist')}
                      </option>
                      {playlists.map((p) => (
                        <option key={p.id} value={p.id}>
                          {playlistDisplayName(p, t)}
                        </option>
                      ))}
                    </select>
                  )}{' '}
                  <button className="danger" onClick={() => void handleDelete(tr)} title={t('library.deleteTooltip')}>
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
