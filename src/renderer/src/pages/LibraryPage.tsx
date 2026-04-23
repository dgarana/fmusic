import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useLibraryStore } from '../store/library';
import { usePlayerStore } from '../store/player';
import { useSonosStore } from '../store/sonos';
import { useSettingsStore } from '../store/settings';
import { formatDuration } from '../util';
import { useT, playlistDisplayName } from '../i18n';
import type { Track, TrackSortKey } from '../../../shared/types';
import { TrackTitleCell } from '../components/TrackTitleCell';
import {
  PlayIcon,
  EditIcon,
  QrCodeIcon,
  PlusIcon,
  CloseIcon,
  SearchIcon
} from '../components/icons';

export function LibraryPage() {
  const t = useT();
  const navigate = useNavigate();
  const columns: Array<{ key: TrackSortKey; label: string }> = [
    { key: 'title', label: t('library.columns.title') },
    { key: 'artist', label: t('library.columns.artist') },
    { key: 'album', label: t('library.columns.album') },
    { key: 'durationSec', label: t('library.columns.duration') }
  ];
  const { tracks, genres, query, setQuery } = useLibraryStore();
  const playTrack = usePlayerStore((s) => s.playTrack);
  const currentTrack = usePlayerStore((s) => s.current);
  const localIsPlaying = usePlayerStore((s) => s.isPlaying);
  const sonosActiveHost = useSonosStore((s) => s.activeHost);
  const sonosIsPlaying = useSonosStore((s) => s.isPlaying);
  // When casting, the true playback state lives in the Sonos store (the
  // local Howl is always paused/unloaded while the speaker plays).
  const isPlayingGlobal = sonosActiveHost !== null ? sonosIsPlaying : localIsPlaying;
  const { settings } = useSettingsStore();

  const [addingTrackId, setAddingTrackId] = useState<number | null>(null);
  const [mobileSyncTrackId, setMobileSyncTrackId] = useState<number | null>(null);
  const [mobileSyncUrl, setMobileSyncUrl] = useState<string | null>(null);
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

  function togglePlaylistPicker(trackId: number) {
    setMobileSyncTrackId(null);
    setAddingTrackId((current) => (current === trackId ? null : trackId));
  }

  async function toggleMobileSync(trackId: number) {
    if (mobileSyncTrackId === trackId) {
      setMobileSyncTrackId(null);
      setMobileSyncUrl(null);
      return;
    }

    if (!settings?.mobileSyncEnabled) {
      alert(t('library.mobileSyncDisabled'));
      return;
    }

    setAddingTrackId(null);
    setMobileSyncTrackId(trackId);
    setMobileSyncUrl(null);
    try {
      const url = await window.fmusic.getMobileSyncUrl(trackId);
      setMobileSyncUrl(url);
    } catch (err) {
      alert(t('common.error') + ': ' + (err instanceof Error ? err.message : String(err)));
      setMobileSyncTrackId(null);
    }
  }

  return (
    <div>
      <h1>{t('library.title')}</h1>
      <div className="library-toolbar">
        <div className="input-with-icon">
          <SearchIcon size={16} />
          <input
            placeholder={t('library.searchPlaceholder')}
            value={query.search ?? ''}
            onChange={(e) => void setQuery({ search: e.target.value })}
          />
        </div>
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
        <table className="track-table compact">
          {/* Fixed column widths so long titles/artists truncate with
              ellipsis instead of stretching the table beyond the viewport. */}
          <colgroup>
            <col />
            <col className="col-artist" />
            <col className="col-album" />
            <col className="col-duration" />
            <col className="col-playlists" />
            <col className="col-actions" />
          </colgroup>
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
              const trackPlaylistIds = playlistsByTrack.get(tr.id) ?? [];
              const isCurrent = currentTrack?.id === tr.id;
              return (
                <Fragment key={tr.id}>
                  <tr key={tr.id} className={isCurrent ? 'now-playing' : undefined}>
                    <td className="cell-flex">
                      <TrackTitleCell
                        track={tr}
                        isCurrent={isCurrent}
                        isPlaying={isCurrent && isPlayingGlobal}
                      />
                    </td>
                    <td className="cell-ellipsis" title={tr.artist ?? undefined}>{tr.artist ?? '-'}</td>
                    <td className="cell-ellipsis" title={tr.album ?? undefined}>{tr.album ?? '-'}</td>
                    <td className="cell-narrow">{formatDuration(tr.durationSec)}</td>
                    <td>
                      {trackPlaylistIds.length === 0 ? (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {trackPlaylistIds.map((id) => {
                            const name = playlistsById.get(id);
                            if (!name) return null;
                            return (
                              <Link
                                key={id}
                                to={`/playlists/${id}`}
                                className="status-pill clickable"
                                title={name}
                                data-title={name}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <span className="status-pill-inner">{name}</span>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="actions">
                      <div className="row-actions">
                        <button
                          className="icon-btn sm"
                          onClick={() => void playTrack(tr, tracks)}
                          title={t('library.playTooltip')}
                        >
                          <PlayIcon size={14} />
                        </button>
                        <button
                          className="icon-btn sm"
                          onClick={() => navigate(`/edit/${tr.id}`)}
                          title={t('library.editorTooltip')}
                        >
                          <EditIcon size={14} />
                        </button>
                        <button
                          className="icon-btn sm"
                          onClick={() => togglePlaylistPicker(tr.id)}
                          title={t('library.addToPlaylistTooltip')}
                        >
                          <PlusIcon size={14} />
                        </button>
                        {settings?.mobileSyncEnabled && (
                          <button
                            className="icon-btn sm"
                            onClick={() => void toggleMobileSync(tr.id)}
                            title={t('library.mobileSyncTooltip')}
                          >
                            <QrCodeIcon size={14} />
                          </button>
                        )}
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
                        )}
                        <button
                          className="icon-btn sm danger"
                          onClick={() => void handleDelete(tr)}
                          title={t('library.deleteTooltip')}
                        >
                          <CloseIcon size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {mobileSyncTrackId === tr.id && (
                    <tr key={`${tr.id}-mobile-sync`} className="track-editor-row">
                      <td colSpan={6}>
                        <div className="mobile-sync-card">
                          <div className="mobile-sync-header">
                            <h3>{t('library.mobileSyncTitle')}</h3>
                            {mobileSyncUrl && (
                              <p>{t('library.mobileSyncInstructions', { title: tr.title })}</p>
                            )}
                          </div>

                          {mobileSyncUrl ? (
                            <>
                              <div className="mobile-sync-qr-wrapper">
                                <QRCodeSVG
                                  value={mobileSyncUrl}
                                  size={220}
                                  level="H"
                                  includeMargin={false}
                                  imageSettings={{
                                    src: 'fmusic-media://artwork/' + tr.id,
                                    height: 40,
                                    width: 40,
                                    excavate: true
                                  }}
                                />
                              </div>
                              <div className="mobile-sync-url">{mobileSyncUrl}</div>
                            </>
                          ) : (
                            <div className="empty" style={{ fontStyle: 'normal' }}>
                              {t('common.loading')}
                            </div>
                          )}

                          <div className="track-editor-actions" style={{ marginTop: 24 }}>
                            <button onClick={() => setMobileSyncTrackId(null)}>
                              {t('common.cancel')}
                            </button>
                          </div>
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
    </div>
  );
}
