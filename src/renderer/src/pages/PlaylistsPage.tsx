import { Fragment, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLibraryStore } from '../store/library';
import { usePlayerStore } from '../store/player';
import { useSonosStore } from '../store/sonos';
import { formatAddedDate, formatDuration } from '../util';
import { useT, playlistDisplayName } from '../i18n';
import type { Playlist, Track } from '../../../shared/types';
import { MobileSyncCard } from '../components/MobileSyncCard';
import { SmartPlaylistComposer } from '../components/SmartPlaylistComposer';
import { TrackTitleCell } from '../components/TrackTitleCell';
import { useMobileSync } from '../hooks/useMobileSync';
import {
  MusicIcon,
  PlayIcon,
  EditIcon,
  QrCodeIcon,
  ChevronUpIcon,
  CloseIcon,
  SearchIcon,
  SparklesIcon
} from '../components/icons';

function getRenamePlaylistErrorMessage(
  error: unknown,
  attemptedName: string,
  t: ReturnType<typeof useT>
) {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.includes('UNIQUE constraint failed: playlists.name')) {
    return t('playlists.renameDuplicate', { name: attemptedName });
  }
  return t('playlists.renameError', { detail });
}

export function PlaylistsPage() {
  const t = useT();
  const navigate = useNavigate();
  const params = useParams();
  const { playlists, refreshPlaylists } = useLibraryStore();
  const [newName, setNewName] = useState('');
  const [smartComposerOpen, setSmartComposerOpen] = useState(false);

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

  async function handleRename(id: number, nextName: string) {
    try {
      await window.fmusic.renamePlaylist(id, nextName);
      await refreshPlaylists();
    } catch (err) {
      alert(getRenamePlaylistErrorMessage(err, nextName, t));
      throw err;
    }
  }

  if (activePlaylist) {
    return <PlaylistDetail playlist={activePlaylist} onRename={handleRename} />;
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
        <button onClick={() => setSmartComposerOpen((current) => !current)}>
          {t('playlists.smart.openComposer')}
        </button>
      </div>

      {smartComposerOpen && (
        <SmartPlaylistComposer
          onClose={() => setSmartComposerOpen(false)}
          onCreated={(playlistId) => {
            void (async () => {
              await refreshPlaylists();
              navigate(`/playlists/${playlistId}`);
            })();
          }}
        />
      )}

      {playlists.length === 0 ? (
        <div className="empty">{t('playlists.none')}</div>
      ) : (
        <div className="results-grid">
          {playlists.map((p) => {
            const displayName = playlistDisplayName(p, t);
            const isBuiltin = Boolean(p.slug);
            const isSmart = p.kind === 'smart';
            return (
              <div key={p.id} className="result-card p-16">
                <div className="title flex items-center gap-8 fs-16">
                  <EditableTitle
                    initialValue={displayName}
                    onSave={(nextName) => handleRename(p.id, nextName)}
                    readonly={isBuiltin}
                    placeholder={t('playlists.renamePrompt')}
                  />
                  {isSmart && (
                    <span className="smart-playlist-badge" title={t('playlists.smart.badge')}>
                      <SparklesIcon size={12} />
                      <span>{t('playlists.smart.badge')}</span>
                    </span>
                  )}
                </div>
                <div className="channel">{t('playlists.tracks', { count: p.trackCount })}</div>
                <div className="actions mt-10">
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

function EditableTitle({
  initialValue,
  onSave,
  readonly,
  placeholder
}: {
  initialValue: string;
  onSave: (value: string) => Promise<void>;
  readonly?: boolean;
  placeholder?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  async function handleSave() {
    if (readonly || saving) return;
    const trimmed = value.trim();
    if (!trimmed) {
      setValue(initialValue);
      setIsEditing(false);
      return;
    }
    if (trimmed === initialValue) {
      setIsEditing(false);
      return;
    }

    setSaving(true);
    try {
      await onSave(trimmed);
      setIsEditing(false);
    } catch (err) {
      setValue(initialValue);
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (isEditing && !readonly) {
    return (
      <div className="editable-title-container">
        <input
          ref={inputRef}
          className="editable-title-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void handleSave()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSave();
            if (e.key === 'Escape') {
              setValue(initialValue);
              setIsEditing(false);
            }
          }}
          disabled={saving}
          placeholder={placeholder}
        />
      </div>
    );
  }

  return (
    <div className="editable-title-container">
      <span
        className={`editable-title-text${readonly ? ' readonly' : ''}`}
        onClick={() => !readonly && setIsEditing(true)}
        title={readonly ? undefined : placeholder}
      >
        {initialValue}
      </span>
    </div>
  );
}

function PlaylistDetail({
  playlist,
  onRename
}: {
  playlist: Playlist;
  onRename: (id: number, nextName: string) => Promise<void>;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { id } = playlist;
  const name = playlistDisplayName(playlist, t);
  const isSmartPlaylist = playlist.kind === 'smart';
  const [tracks, setTracks] = useState<Track[]>([]);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [editingSmartPlaylist, setEditingSmartPlaylist] = useState(false);
  const {
    mobileSyncEnabled,
    mobileSyncTrackId,
    mobileSyncUrl,
    toggleMobileSync,
    closeMobileSync
  } = useMobileSync();
  const playTrack = usePlayerStore((s) => s.playTrack);
  const currentTrack = usePlayerStore((s) => s.current);
  const localIsPlaying = usePlayerStore((s) => s.isPlaying);
  const sonosActiveHost = useSonosStore((s) => s.activeHost);
  const sonosIsPlaying = useSonosStore((s) => s.isPlaying);
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
      <div className="flex items-center gap-12 mb-18">
        <h1 className="m-0 flex items-center gap-10">
          <MusicIcon size={22} />
          <EditableTitle
            initialValue={name}
            onSave={(nextName) => onRename(id, nextName)}
            readonly={Boolean(playlist.slug)}
            placeholder={t('playlists.renamePrompt')}
          />
        </h1>
        {isSmartPlaylist && (
          <span className="smart-playlist-badge" title={t('playlists.smart.badge')}>
            <SparklesIcon size={12} />
            <span>{t('playlists.smart.badge')}</span>
          </span>
        )}
        {!isSmartPlaylist && (
          <button className="primary" onClick={() => void openPicker()}>
            {t('playlists.addTracks')}
          </button>
        )}
        {isSmartPlaylist && (
          <button onClick={() => setEditingSmartPlaylist(true)}>
            {t('playlists.smart.edit')}
          </button>
        )}
      </div>

      {isSmartPlaylist && (
        <div className="smart-playlist-footnote mb-18">
          {t('playlists.smart.dynamicNotice')}
        </div>
      )}

      {editingSmartPlaylist && playlist.smartDefinition && (
        <SmartPlaylistComposer
          playlistId={playlist.id}
          initialName={playlist.name}
          initialDefinition={playlist.smartDefinition}
          onClose={() => setEditingSmartPlaylist(false)}
          onSaved={() => {
            void (async () => {
              await refreshPlaylists();
              await refresh();
            })();
          }}
        />
      )}

      {playlist.sourceUrl && (
        <div className="editor-file-location mb-16">
          <span className="editor-file-location-label">{t('editor.sourceUrl')}</span>
          <code>{playlist.sourceUrl}</code>
          <button
            onClick={() => void window.fmusic.openExternal(playlist.sourceUrl!)}
            title={t('editor.openSource')}
          >
            {t('editor.openSource')}
          </button>
        </div>
      )}

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
            <div className="empty p-12">
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
                  <div className="flex-1 min-w-0">
                    <div className="fw-600">{t.title}</div>
                    <div className="text-muted fs-12">
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
            <col className="col-added" />
            <col className="col-actions playlist-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>{t('playlists.columns.title')}</th>
              <th>{t('playlists.columns.artist')}</th>
              <th>{t('library.columns.album')}</th>
              <th>{t('playlists.columns.duration')}</th>
              <th>{t('library.columns.downloaded')}</th>
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
                    <td className="cell-narrow" title={tr.downloadedAt}>{formatAddedDate(tr.downloadedAt)}</td>
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
                        {mobileSyncEnabled && (
                          <button
                            className="icon-btn sm"
                            onClick={() => void toggleMobileSync(tr.id)}
                            title={t('library.mobileSyncTooltip')}
                          >
                            <QrCodeIcon size={14} />
                          </button>
                        )}
                        {!isSmartPlaylist && (
                          <>
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
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {mobileSyncTrackId === tr.id && (
                    <tr className="track-editor-row">
                      <td colSpan={5}>
                        <MobileSyncCard
                          trackId={tr.id}
                          trackTitle={tr.title}
                          mobileSyncUrl={mobileSyncUrl}
                          onClose={closeMobileSync}
                        />
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
