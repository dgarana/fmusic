import { Fragment, useEffect, useMemo, useState } from 'react';
import { useLibraryStore } from '../store/library';
import { usePlayerStore } from '../store/player';
import { formatDuration } from '../util';
import { useT, playlistDisplayName } from '../i18n';
import type { Track, TrackMetadataSuggestions, TrackSortKey } from '../../../shared/types';

interface EditDraft {
  title: string;
  artist: string;
  album: string;
  genre: string;
}

interface SyncFeedback {
  trackId: number;
  kind: 'info' | 'error';
  message: string;
}

function draftFromTrack(track: Track): EditDraft {
  return {
    title: track.title,
    artist: track.artist ?? '',
    album: track.album ?? '',
    genre: track.genre ?? ''
  };
}

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function TrackTitleCell({ track }: { track: Track }) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setThumbnailUrl(null);
    void window.fmusic.trackArtworkDataUrl(track.id).then((url) => {
      if (!cancelled) setThumbnailUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [track.id]);

  return (
    <div className="track-title-cell">
      {thumbnailUrl ? (
        <img
          className="track-thumb"
          src={thumbnailUrl}
          alt=""
          loading="lazy"
        />
      ) : (
        <div className="track-thumb-fallback" aria-hidden="true">♪</div>
      )}
      <span className="track-title-text">{track.title}</span>
    </div>
  );
}

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
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [savingTrackId, setSavingTrackId] = useState<number | null>(null);
  const [syncingTrackId, setSyncingTrackId] = useState<number | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<SyncFeedback | null>(null);
  const playlists = useLibraryStore((s) => s.playlists);
  const refreshPlaylists = useLibraryStore((s) => s.refreshPlaylists);
  const refreshTracks = useLibraryStore((s) => s.refreshTracks);
  const refreshGenres = useLibraryStore((s) => s.refreshGenres);
  const [playlistsByTrack, setPlaylistsByTrack] = useState<Map<number, number[]>>(new Map());
  const [metadataSuggestions, setMetadataSuggestions] = useState<TrackMetadataSuggestions>({
    artists: [],
    albums: [],
    genres: []
  });

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

  useEffect(() => {
    let cancelled = false;
    void window.fmusic.trackMetadataSuggestions().then((suggestions) => {
      if (!cancelled) setMetadataSuggestions(suggestions);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  function togglePlaylistPicker(trackId: number) {
    stopEditing();
    setAddingTrackId((current) => (current === trackId ? null : trackId));
  }

  function startEditing(track: Track) {
    setAddingTrackId(null);
    setEditingTrackId(track.id);
    setEditDraft(draftFromTrack(track));
  }

  function stopEditing() {
    setEditingTrackId(null);
    setEditDraft(null);
    setSyncFeedback(null);
  }

  async function handleSaveMetadata(trackId: number) {
    if (!editDraft) return;
    setSavingTrackId(trackId);
    try {
      await window.fmusic.updateTrack(trackId, {
        title: editDraft.title.trim() || t('library.untitledFallback'),
        artist: normalizeOptionalText(editDraft.artist),
        album: normalizeOptionalText(editDraft.album),
        genre: normalizeOptionalText(editDraft.genre)
      });
      await Promise.all([
        refreshTracks(),
        refreshGenres(),
        window.fmusic.trackMetadataSuggestions().then(setMetadataSuggestions)
      ]);
      setSyncFeedback(null);
      stopEditing();
    } finally {
      setSavingTrackId(null);
    }
  }

  async function handleLookupMetadata(track: Track) {
    setAddingTrackId(null);
    setSyncFeedback(null);
    setSyncingTrackId(track.id);
    try {
      const result = await window.fmusic.lookupTrackMetadata(track.id);
      if (!result) {
        setSyncFeedback({
          trackId: track.id,
          kind: 'info',
          message: t('library.syncMetadataNotFound')
        });
        return;
      }

      setEditingTrackId(track.id);
      setEditDraft({
        title: result.title || track.title,
        artist: result.artist ?? track.artist ?? '',
        album: result.album ?? track.album ?? '',
        genre: result.genre ?? ''
      });
      setSyncFeedback({
        trackId: track.id,
        kind: 'info',
        message: t('library.syncMetadataLoaded', { source: result.source })
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setSyncFeedback({
        trackId: track.id,
        kind: 'error',
        message: t('library.syncMetadataError', { detail })
      });
    } finally {
      setSyncingTrackId(null);
    }
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
              const showEditor = editingTrackId === tr.id && editDraft;
              const showFeedback = syncFeedback?.trackId === tr.id;
              return (
                <Fragment key={tr.id}>
                  <tr key={tr.id}>
                    <td><TrackTitleCell track={tr} /></td>
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
                        onClick={() => startEditing(tr)}
                        title={t('library.editMetadataTooltip')}
                      >
                        ✎
                      </button>{' '}
                      <button
                        onClick={() => void handleLookupMetadata(tr)}
                        title={t('library.syncMetadataTooltip')}
                        disabled={syncingTrackId === tr.id}
                      >
                        {syncingTrackId === tr.id ? '…' : '↻'}
                      </button>{' '}
                      <button
                        onClick={() => togglePlaylistPicker(tr.id)}
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
                  {showEditor && (
                    <tr key={`${tr.id}-editor`} className="track-editor-row">
                      <td colSpan={8}>
                        <div className="track-editor">
                          {showFeedback && (
                            <div className={`track-editor-feedback ${syncFeedback.kind}`}>
                              {syncFeedback.message}
                            </div>
                          )}
                          <label>
                            <span>{t('library.columns.title')}</span>
                            <input
                              value={editDraft.title}
                              onChange={(e) =>
                                setEditDraft((draft) =>
                                  draft ? { ...draft, title: e.target.value } : draft
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>{t('library.columns.artist')}</span>
                            <input
                              list="library-artists"
                              value={editDraft.artist}
                              onChange={(e) =>
                                setEditDraft((draft) =>
                                  draft ? { ...draft, artist: e.target.value } : draft
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>{t('library.columns.album')}</span>
                            <input
                              list="library-albums"
                              value={editDraft.album}
                              onChange={(e) =>
                                setEditDraft((draft) =>
                                  draft ? { ...draft, album: e.target.value } : draft
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>{t('library.columns.genre')}</span>
                            <input
                              list="library-genres"
                              value={editDraft.genre}
                              onChange={(e) =>
                                setEditDraft((draft) =>
                                  draft ? { ...draft, genre: e.target.value } : draft
                                )
                              }
                            />
                          </label>
                          <div className="track-editor-actions">
                            <button onClick={stopEditing}>{t('common.cancel')}</button>
                            <button
                              className="primary"
                              onClick={() => void handleSaveMetadata(tr.id)}
                              disabled={savingTrackId === tr.id}
                            >
                              {savingTrackId === tr.id
                                ? t('library.savingMetadata')
                                : t('library.saveMetadata')}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  {showFeedback && !showEditor && (
                    <tr key={`${tr.id}-feedback`} className="track-editor-row">
                      <td colSpan={8}>
                        <div className={`track-editor-feedback ${syncFeedback.kind}`}>
                          {syncFeedback.message}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      <datalist id="library-artists">
        {metadataSuggestions.artists.map((artist) => (
          <option key={artist} value={artist} />
        ))}
      </datalist>
      <datalist id="library-albums">
        {metadataSuggestions.albums.map((album) => (
          <option key={album} value={album} />
        ))}
      </datalist>
      <datalist id="library-genres">
        {metadataSuggestions.genres.map((genre) => (
          <option key={genre} value={genre} />
        ))}
      </datalist>
    </div>
  );
}
