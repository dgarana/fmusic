import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLibraryStore } from '../store/library';
import { usePlayerStore } from '../store/player';
import { formatDuration } from '../util';
import { useT, playlistDisplayName } from '../i18n';
import type { Playlist, Track } from '../../../shared/types';
import {
  MusicIcon,
  PlayIcon,
  ChevronUpIcon,
  CloseIcon,
  SearchIcon
} from '../components/icons';
import { NowPlayingIndicator } from '../components/NowPlayingIndicator';

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
  const { id } = playlist;
  const name = playlistDisplayName(playlist, t);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const currentTrack = usePlayerStore((s) => s.current);
  const isPlayingGlobal = usePlayerStore((s) => s.isPlaying);
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
        <table className="track-table">
          <thead>
            <tr>
              <th>{t('playlists.columns.index')}</th>
              <th>{t('playlists.columns.title')}</th>
              <th>{t('playlists.columns.artist')}</th>
              <th>{t('playlists.columns.duration')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((tr, i) => {
              const isCurrent = currentTrack?.id === tr.id;
              return (
              <tr key={tr.id} className={isCurrent ? 'now-playing' : undefined}>
                <td>
                  {isCurrent ? (
                    <span className="now-playing-indicator-cell">
                      <NowPlayingIndicator playing={isPlayingGlobal} size={16} />
                    </span>
                  ) : (
                    i + 1
                  )}
                </td>
                <td>{tr.title}</td>
                <td>{tr.artist ?? '-'}</td>
                <td>{formatDuration(tr.durationSec)}</td>
                <td className="actions">
                  <div className="row-actions">
                    <button
                      className="icon-btn"
                      onClick={() => void playTrack(tr, tracks)}
                      title={t('playlists.playTooltip')}
                    >
                      <PlayIcon size={16} />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => void moveUp(i)}
                      disabled={i === 0}
                      title={t('playlists.moveUpTooltip')}
                    >
                      <ChevronUpIcon size={16} />
                    </button>
                    <button
                      className="icon-btn danger"
                      onClick={() => void remove(tr.id)}
                      title={t('playlists.removeTooltip')}
                    >
                      <CloseIcon size={16} />
                    </button>
                  </div>
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
