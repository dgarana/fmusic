import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useLibraryStore } from '../store/library';
import { usePlayerStore } from '../store/player';
import { useSonosStore } from '../store/sonos';
import { useSettingsStore } from '../store/settings';
import { formatDuration } from '../util';
import { useT, playlistDisplayName } from '../i18n';
import type { Playlist, Track } from '../../../shared/types';
import { TrackTitleCell } from '../components/TrackTitleCell';
import {
  MusicIcon,
  PlayIcon,
  EditIcon,
  QrCodeIcon,
  ChevronUpIcon,
  CloseIcon,
  SearchIcon
} from '../components/icons';

export function PlaylistsPage() {
  const t = useT();
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
    return <PlaylistDetail playlist={activePlaylist} />;
  }

  return (
    <div>
      <h1>{t('playlists.title')}</h1>
      <div className="search-row">
        <input
          placeholder={t('playlists.newPlaceholder')}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void createPlaylist();
          }}
        />
        <button className="primary" onClick={() => void createPlaylist()}>
          {t('playlists.create')}
        </button>
      </div>

      {playlists.length === 0 ? (
        <div className="empty">{t('playlists.none')}</div>
      ) : (
        <div className="results-grid">
          {playlists.map((p) => {
            const displayName = playlistDisplayName(p, t);
            const isBuiltin = Boolean(p.slug);
            return (
              <div key={p.id} className="result-card" style={{ padding: 16 }}>
                <div className="title" style={{ fontSize: 16 }}>
                  {displayName}
                </div>
                <div className="channel">{t('playlists.tracks', { count: p.trackCount })}</div>
                <div className="actions" style={{ marginTop: 10 }}>
                  <a href={`#/playlists/${p.id}`}>
                    <button>{t('playlists.open')}</button>
                  </a>
                  {!isBuiltin && (
                    <button
                      className="danger"
                      onClick={async () => {
                        if (!confirm(t('playlists.deleteConfirm', { name: displayName }))) return;
                        await window.fmusic.deletePlaylist(p.id);
                        await refreshPlaylists();
                      }}
                    >
                      {t('playlists.delete')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlaylistDetail({ playlist }: { playlist: Playlist }) {
  const t = useT();
  const navigate = useNavigate();
  const { id } = playlist;
  const name = playlistDisplayName(playlist, t);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [mobileSyncTrackId, setMobileSyncTrackId] = useState<number | null>(null);
  const [mobileSyncUrl, setMobileSyncUrl] = useState<string | null>(null);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const currentTrack = usePlayerStore((s) => s.current);
  const localIsPlaying = usePlayerStore((s) => s.isPlaying);
  const sonosActiveHost = useSonosStore((s) => s.activeHost);
  const sonosIsPlaying = useSonosStore((s) => s.isPlaying);
  const { settings } = useSettingsStore();
  // When casting, the true playback state lives in the Sonos store.
  const isPlayingGlobal = sonosActiveHost !== null ? sonosIsPlaying : localIsPlaying;
  const refreshPlaylists = useLibraryStore((s) => s.refreshPlaylists);
  const playlistsVersion = useLibraryStore((s) => s.playlistsVersion);

  async function refresh() {
    const list = await window.fmusic.listTracks({ playlistId: id });
    setTracks(list);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, playlistsVersion]);

  async function openPicker() {
    setAdding(false);
    setSelected(new Set());
    setPickerQuery('');
    setPickerOpen(true);
    const all = await window.fmusic.listTracks({
      sortBy: 'title',
      sortDir: 'asc',
      limit: 10_000
    });
    setAllTracks(all);
  }

  async function commitAdd() {
    if (selected.size === 0) return;
    setAdding(true);
    for (const trackId of selected) {
      await window.fmusic.addTrackToPlaylist(id, trackId);
    }
    setPickerOpen(false);
    setSelected(new Set());
    setAdding(false);
    await refresh();
    await refreshPlaylists();
  }

  async function remove(trackId: number) {
    await window.fmusic.removeTrackFromPlaylist(id, trackId);
    await refresh();
    await refreshPlaylists();
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

  async function moveUp(index: number) {
    if (index === 0) return;
    const ordered = [...tracks];
    [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]];
    setTracks(ordered);
    await window.fmusic.reorderPlaylist(id, ordered.map((t) => t.id));
  }

  const inPlaylist = useMemo(() => new Set(tracks.map((t) => t.id)), [tracks]);
  const candidates = useMemo(() => {
    const needle = pickerQuery.trim().toLowerCase();
    return allTracks.filter((t) => {
      if (inPlaylist.has(t.id)) return false;
      if (!needle) return true;
      const haystack = [t.title, t.artist, t.album, t.genre].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [allTracks, inPlaylist, pickerQuery]);

  function toggle(trackId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <MusicIcon size={22} /> {name}
        </h1>
        <button className="primary" onClick={() => void openPicker()}>
          {t('playlists.addTracks')}
        </button>
      </div>

      {pickerOpen && (
        <div className="picker-card">
          <div className="picker-toolbar">
            <div className="input-with-icon">
              <SearchIcon size={16} />
              <input
                placeholder={t('playlists.pickerFilter')}
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                autoFocus
              />
            </div>
            <button
              className="primary"
              onClick={() => void commitAdd()}
              disabled={selected.size === 0 || adding}
            >
              {adding ? t('playlists.pickerAdding') : t('playlists.pickerAdd', { count: selected.size || '' })}
            </button>
            <button onClick={() => setPickerOpen(false)}>{t('playlists.pickerCancel')}</button>
          </div>
          {candidates.length === 0 ? (
            <div className="empty" style={{ padding: 12 }}>
              {allTracks.length === 0 ? t('playlists.libraryEmpty') : t('playlists.allAlreadyIn')}
            </div>
          ) : (
            <div className="picker-list">
              {candidates.map((t) => (
                <label key={t.id} className="picker-row">
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{t.title}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {t.artist ?? '-'} &middot; {formatDuration(t.durationSec)}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {tracks.length === 0 ? (
        <div className="empty">
          {t('playlists.empty')}
        </div>
      ) : (
        <table className="track-table compact">
          <colgroup>
            <col />
            <col className="col-artist" />
            <col className="col-album" />
            <col className="col-duration" />
            <col className="col-actions playlist-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>{t('playlists.columns.title')}</th>
              <th>{t('playlists.columns.artist')}</th>
              <th>{t('library.columns.album')}</th>
              <th>{t('playlists.columns.duration')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((tr, i) => {
              const isCurrent = currentTrack?.id === tr.id;
              return (
                <Fragment key={tr.id}>
                  <tr className={isCurrent ? 'now-playing' : undefined}>
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
                    <td className="actions">
                      <div className="row-actions">
                        <button
                          className="icon-btn sm"
                          onClick={() => void playTrack(tr, tracks)}
                          title={t('playlists.playTooltip')}
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
                        {settings?.mobileSyncEnabled && (
                          <button
                            className="icon-btn sm"
                            onClick={() => void toggleMobileSync(tr.id)}
                            title={t('library.mobileSyncTooltip')}
                          >
                            <QrCodeIcon size={14} />
                          </button>
                        )}
                        <button
                          className="icon-btn sm"
                          onClick={() => void moveUp(i)}
                          disabled={i === 0}
                          title={t('playlists.moveUpTooltip')}
                        >
                          <ChevronUpIcon size={14} />
                        </button>
                        <button
                          className="icon-btn sm danger"
                          onClick={() => void remove(tr.id)}
                          title={t('playlists.removeTooltip')}
                        >
                          <CloseIcon size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {mobileSyncTrackId === tr.id && (
                    <tr className="track-editor-row">
                      <td colSpan={5}>
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
