import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLibraryStore } from '../store/library';
import { usePlayerStore } from '../store/player';
import { formatDuration } from '../util';
import { useT } from '../i18n';
import type { Track, TrackMetadataSuggestions } from '../../../shared/types';
import {
  ArrowLeftIcon,
  PlayIcon,
  PauseIcon,
  ScissorsIcon,
  SparklesIcon,
  VolumeIcon,
  PinIcon,
  RefreshIcon,
  MusicIcon
} from '../components/icons';

interface MetadataDraft {
  title: string;
  artist: string;
  album: string;
  genre: string;
}

interface AudioDraft {
  trimStart: string;
  trimEnd: string;
  fadeIn: string;
  fadeOut: string;
  volume: number;
}

interface Feedback {
  kind: 'info' | 'error' | 'success';
  message: string;
}

function metadataFromTrack(track: Track): MetadataDraft {
  return {
    title: track.title,
    artist: track.artist ?? '',
    album: track.album ?? '',
    genre: track.genre ?? ''
  };
}

function audioFromTrack(track: Track): AudioDraft {
  return {
    trimStart: '0',
    trimEnd: String(track.durationSec ?? ''),
    fadeIn: '0',
    fadeOut: '0',
    volume: 100
  };
}

function splitFilename(filePath: string): { basename: string; extension: string; dir: string } {
  // Electron runs on all platforms, so handle both separators.
  const normalized = filePath.replace(/\\/g, '/');
  const lastSep = normalized.lastIndexOf('/');
  const dir = lastSep >= 0 ? filePath.slice(0, lastSep) : '';
  const file = lastSep >= 0 ? normalized.slice(lastSep + 1) : normalized;
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return { basename: file, extension: '', dir };
  return { basename: file.slice(0, dot), extension: file.slice(dot), dir };
}

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function EditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const t = useT();
  const refreshTracks = useLibraryStore((s) => s.refreshTracks);
  const refreshGenres = useLibraryStore((s) => s.refreshGenres);

  const [track, setTrack] = useState<Track | null>(null);
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft | null>(null);
  const [filenameDraft, setFilenameDraft] = useState<string>('');
  const [audioDraft, setAudioDraft] = useState<AudioDraft | null>(null);
  const [metadataSuggestions, setMetadataSuggestions] = useState<TrackMetadataSuggestions>({
    artists: [],
    albums: [],
    genres: []
  });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [processingAudio, setProcessingAudio] = useState(false);

  const playTrack = usePlayerStore((s) => s.playTrack);
  const currentTrack = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const playerPosition = usePlayerStore((s) => s.position);
  const seek = usePlayerStore((s) => s.seek);

  // Load the track + metadata suggestions on mount.
  useEffect(() => {
    if (!id) {
      navigate('/library');
      return;
    }
    const trackId = parseInt(id, 10);
    let cancelled = false;
    void window.fmusic
      .getTrack(trackId)
      .then((tr) => {
        if (cancelled) return;
        if (!tr) {
          navigate('/library');
          return;
        }
        setTrack(tr);
        setMetadataDraft(metadataFromTrack(tr));
        setAudioDraft(audioFromTrack(tr));
        const { basename } = splitFilename(tr.filePath);
        setFilenameDraft(basename);
      })
      .catch(() => navigate('/library'));
    void window.fmusic.trackMetadataSuggestions().then((suggestions) => {
      if (!cancelled) setMetadataSuggestions(suggestions);
    });
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  const fileLocation = useMemo(() => {
    if (!track) return { dir: '', extension: '' };
    const { dir, extension } = splitFilename(track.filePath);
    return { dir, extension };
  }, [track]);

  if (!track || !metadataDraft || !audioDraft) {
    return (
      <div className="edit-page">
        <div className="empty">{t('editor.loading')}</div>
      </div>
    );
  }

  const duration = track.durationSec || 1;
  const trimStartNum = parseFloat(audioDraft.trimStart) || 0;
  const trimEndNum = audioDraft.trimEnd ? parseFloat(audioDraft.trimEnd) : duration;
  const startPercent = (trimStartNum / duration) * 100;
  const endPercent = (trimEndNum / duration) * 100;
  const isCurrentTrack = currentTrack?.id === track.id;

  async function handleLookupMetadata() {
    setFeedback(null);
    setLookingUp(true);
    try {
      const result = await window.fmusic.lookupTrackMetadata(track!.id);
      if (!result) {
        setFeedback({ kind: 'info', message: t('editor.metadataNotFound') });
        return;
      }
      setMetadataDraft({
        title: result.title || track!.title,
        artist: result.artist ?? metadataDraft!.artist,
        album: result.album ?? metadataDraft!.album,
        genre: result.genre ?? metadataDraft!.genre
      });
      setFeedback({
        kind: 'info',
        message: t('editor.metadataLoaded', { source: result.source })
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setFeedback({ kind: 'error', message: t('editor.metadataLookupError', { detail }) });
    } finally {
      setLookingUp(false);
    }
  }

  async function handleSaveMetadata() {
    if (!metadataDraft) return;
    setFeedback(null);
    setSavingMetadata(true);
    try {
      const trimmedTitle = metadataDraft.title.trim() || t('editor.untitledFallback');
      await window.fmusic.updateTrack(track!.id, {
        title: trimmedTitle,
        artist: normalizeOptionalText(metadataDraft.artist),
        album: normalizeOptionalText(metadataDraft.album),
        genre: normalizeOptionalText(metadataDraft.genre)
      });

      // Rename the file if the user changed the basename. Errors here are
      // surfaced to the user but don't undo the metadata save (which
      // already succeeded).
      const currentBasename = splitFilename(track!.filePath).basename;
      const nextBasename = filenameDraft.trim();
      if (nextBasename && nextBasename !== currentBasename) {
        try {
          await window.fmusic.renameTrackFile(track!.id, nextBasename);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          setFeedback({ kind: 'error', message: t('editor.renameFailed', { detail }) });
          await refreshAfterEdit();
          return;
        }
      }

      await refreshAfterEdit();
      setFeedback({ kind: 'success', message: t('editor.metadataSaved') });
    } finally {
      setSavingMetadata(false);
    }
  }

  async function refreshAfterEdit() {
    const refreshed = await window.fmusic.getTrack(track!.id);
    if (refreshed) {
      setTrack(refreshed);
      setMetadataDraft(metadataFromTrack(refreshed));
      setFilenameDraft(splitFilename(refreshed.filePath).basename);
    }
    await Promise.all([
      refreshTracks(),
      refreshGenres(),
      window.fmusic.trackMetadataSuggestions().then(setMetadataSuggestions)
    ]);
  }

  async function handleApplyAudio(mode: 'overwrite' | 'export') {
    setProcessingAudio(true);
    try {
      await window.fmusic.editTrack(track!.id, {
        startSec: parseFloat(audioDraft!.trimStart) || 0,
        endSec: audioDraft!.trimEnd ? parseFloat(audioDraft!.trimEnd) : null,
        fadeInSec: parseFloat(audioDraft!.fadeIn) || 0,
        fadeOutSec: parseFloat(audioDraft!.fadeOut) || 0,
        volumeFactor: audioDraft!.volume / 100,
        mode
      });
      await refreshTracks();
      navigate('/library');
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessingAudio(false);
    }
  }

  return (
    <div className="edit-page">
      <header className="editor-header">
        <button className="icon-btn" onClick={() => navigate('/library')} title={t('editor.backToLibrary')}>
          <ArrowLeftIcon size={18} />
        </button>
        <h1>{t('editor.title', { title: track.title })}</h1>
      </header>

      {/* Track identity: cover + title + artist/album. Sits above the
          Metadata section so the user always knows which track they are
          editing without taking the space of the audio player. */}
      <section className="editor-summary">
        <div className="editor-summary-cover">
          <TrackCover track={track} />
        </div>
        <div className="editor-summary-info">
          <div className="editor-summary-title">{track.title}</div>
          <div className="editor-summary-sub">
            {[track.artist, track.album].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
      </section>

      {feedback && (
        <div className={`track-editor-feedback ${feedback.kind}`}>
          {feedback.message}
        </div>
      )}

      {/* Metadata section */}
      <section className="editor-section">
        <header className="editor-section-header">
          <h2>{t('editor.sections.metadata')}</h2>
          <button
            onClick={() => void handleLookupMetadata()}
            disabled={lookingUp}
          >
            <RefreshIcon size={14} />
            {lookingUp
              ? t('editor.lookupMetadataInProgress')
              : t('editor.lookupMetadata')}
          </button>
        </header>
        <p className="editor-section-description">{t('editor.metadataDescription')}</p>

        <div className="editor-metadata-grid">
          <label>
            <span>{t('library.columns.title')}</span>
            <input
              value={metadataDraft.title}
              onChange={(e) =>
                setMetadataDraft((draft) => (draft ? { ...draft, title: e.target.value } : draft))
              }
            />
          </label>
          <label>
            <span>{t('library.columns.artist')}</span>
            <input
              list="editor-artists"
              value={metadataDraft.artist}
              onChange={(e) =>
                setMetadataDraft((draft) => (draft ? { ...draft, artist: e.target.value } : draft))
              }
            />
          </label>
          <label>
            <span>{t('library.columns.album')}</span>
            <input
              list="editor-albums"
              value={metadataDraft.album}
              onChange={(e) =>
                setMetadataDraft((draft) => (draft ? { ...draft, album: e.target.value } : draft))
              }
            />
          </label>
          <label>
            <span>{t('library.columns.genre')}</span>
            <input
              list="editor-genres"
              value={metadataDraft.genre}
              onChange={(e) =>
                setMetadataDraft((draft) => (draft ? { ...draft, genre: e.target.value } : draft))
              }
            />
          </label>
          <label className="editor-filename-field">
            <span>{t('editor.filename')}</span>
            <div className="editor-filename-input">
              <input
                value={filenameDraft}
                onChange={(e) => setFilenameDraft(e.target.value)}
              />
              {fileLocation.extension && (
                <span className="editor-filename-ext">{fileLocation.extension}</span>
              )}
            </div>
            <small>{t('editor.filenameDescription')}</small>
          </label>
        </div>

        {fileLocation.dir && (
          <div className="editor-file-location">
            <span className="editor-file-location-label">{t('editor.fileLocation')}</span>
            <code>{fileLocation.dir}</code>
          </div>
        )}

        <div className="editor-section-actions">
          <button onClick={() => navigate('/library')}>{t('common.cancel')}</button>
          <button
            className="primary"
            onClick={() => void handleSaveMetadata()}
            disabled={savingMetadata}
          >
            {savingMetadata ? t('editor.savingMetadata') : t('editor.saveMetadata')}
          </button>
        </div>
      </section>

      {/* Audio section. The player lives at the top of this section because
          its main purpose is to seek the playhead while recording start/end
          marks or previewing fades. */}
      <section className="editor-section">
        <header className="editor-section-header">
          <h2>{t('editor.sections.audio')}</h2>
        </header>
        <p className="editor-section-description">{t('editor.audioDescription')}</p>

        <div className="editor-audio-player">
          <button
            className="icon-btn primary lg"
            onClick={() => {
              if (!isCurrentTrack) {
                void playTrack(track, [track]);
              } else {
                togglePlay();
              }
            }}
            title={isCurrentTrack && isPlaying ? t('player.pause') : t('player.play')}
          >
            {isCurrentTrack && isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </button>
          <div className="editor-audio-player-scrub">
            <span className="time-display">
              {formatDuration(isCurrentTrack ? playerPosition : 0)}
            </span>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={isCurrentTrack ? playerPosition : 0}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isCurrentTrack) {
                  void playTrack(track, [track]).then(() => seek(val));
                } else {
                  seek(val);
                }
              }}
              style={{
                ['--range-progress' as string]: `${
                  duration > 0
                    ? Math.min(
                        Math.max((isCurrentTrack ? playerPosition : 0) / duration, 0),
                        1
                      ) * 100
                    : 0
                }%`
              }}
            />
            <span className="time-display">{formatDuration(duration)}</span>
          </div>
        </div>

        <div className="trim-visual-container">
          <div className="trim-bar-bg">
            <div
              className="trim-bar-active"
              style={{ left: `${startPercent}%`, right: `${100 - endPercent}%` }}
            />
            {isCurrentTrack && (
              <div
                className="trim-bar-current"
                style={{ left: `${(playerPosition / duration) * 100}%` }}
              />
            )}
          </div>
          <input
            type="range"
            className="trim-slider start"
            min={0}
            max={duration}
            step={0.1}
            value={audioDraft.trimStart}
            onChange={(e) => {
              setAudioDraft((draft) => (draft ? { ...draft, trimStart: e.target.value } : draft));
              if (isCurrentTrack) seek(parseFloat(e.target.value));
            }}
          />
          <input
            type="range"
            className="trim-slider end"
            min={0}
            max={duration}
            step={0.1}
            value={audioDraft.trimEnd || duration}
            onChange={(e) => {
              setAudioDraft((draft) => (draft ? { ...draft, trimEnd: e.target.value } : draft));
              if (isCurrentTrack) seek(parseFloat(e.target.value));
            }}
          />
        </div>

        <div className="editor-audio-grid">
          <div className="edit-option-card">
            <label>
              <ScissorsIcon size={14} /> {t('library.trimStart')}
            </label>
            <div className="editor-audio-row">
              <input
                type="number"
                step="0.1"
                value={audioDraft.trimStart}
                onChange={(e) =>
                  setAudioDraft((draft) =>
                    draft ? { ...draft, trimStart: e.target.value } : draft
                  )
                }
              />
              <button
                className="icon-btn"
                title={t('library.trimSetStart')}
                onClick={() =>
                  isCurrentTrack &&
                  setAudioDraft((draft) =>
                    draft ? { ...draft, trimStart: playerPosition.toFixed(1) } : draft
                  )
                }
                disabled={!isCurrentTrack}
              >
                <PinIcon size={16} />
              </button>
            </div>
          </div>
          <div className="edit-option-card">
            <label>
              <ScissorsIcon size={14} /> {t('library.trimEnd')}
            </label>
            <div className="editor-audio-row">
              <input
                type="number"
                step="0.1"
                value={audioDraft.trimEnd}
                onChange={(e) =>
                  setAudioDraft((draft) =>
                    draft ? { ...draft, trimEnd: e.target.value } : draft
                  )
                }
              />
              <button
                className="icon-btn"
                title={t('library.trimSetEnd')}
                onClick={() =>
                  isCurrentTrack &&
                  setAudioDraft((draft) =>
                    draft ? { ...draft, trimEnd: playerPosition.toFixed(1) } : draft
                  )
                }
                disabled={!isCurrentTrack}
              >
                <PinIcon size={16} />
              </button>
            </div>
          </div>
          <div className="edit-option-card">
            <label>
              <SparklesIcon size={14} /> {t('library.editAudioFadeIn')}
            </label>
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={audioDraft.fadeIn}
              onChange={(e) =>
                setAudioDraft((draft) => (draft ? { ...draft, fadeIn: e.target.value } : draft))
              }
            />
          </div>
          <div className="edit-option-card">
            <label>
              <SparklesIcon size={14} /> {t('library.editAudioFadeOut')}
            </label>
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={audioDraft.fadeOut}
              onChange={(e) =>
                setAudioDraft((draft) => (draft ? { ...draft, fadeOut: e.target.value } : draft))
              }
            />
          </div>
          <div className="edit-option-card editor-audio-volume">
            <label>
              <VolumeIcon size={14} /> {t('library.editAudioVolume')} ({audioDraft.volume}%)
            </label>
            <input
              type="range"
              min={0}
              max={200}
              step={1}
              value={audioDraft.volume}
              onChange={(e) =>
                setAudioDraft((draft) =>
                  draft ? { ...draft, volume: parseInt(e.target.value, 10) } : draft
                )
              }
              style={{
                ['--range-progress' as string]: `${Math.min(
                  Math.max(audioDraft.volume / 200, 0),
                  1
                ) * 100}%`
              }}
            />
          </div>
        </div>

        <div className="editor-section-actions">
          <button onClick={() => navigate('/library')}>{t('common.cancel')}</button>
          <button
            className="danger"
            onClick={() => void handleApplyAudio('overwrite')}
            disabled={processingAudio}
          >
            {processingAudio ? t('library.editAudioProcessing') : t('library.editAudioOverwrite')}
          </button>
          <button
            className="primary"
            onClick={() => void handleApplyAudio('export')}
            disabled={processingAudio}
          >
            {processingAudio ? t('library.editAudioProcessing') : t('library.editAudioExport')}
          </button>
        </div>
      </section>

      <datalist id="editor-artists">
        {metadataSuggestions.artists.map((artist) => (
          <option key={artist} value={artist} />
        ))}
      </datalist>
      <datalist id="editor-albums">
        {metadataSuggestions.albums.map((album) => (
          <option key={album} value={album} />
        ))}
      </datalist>
      <datalist id="editor-genres">
        {metadataSuggestions.genres.map((genre) => (
          <option key={genre} value={genre} />
        ))}
      </datalist>
    </div>
  );
}

function TrackCover({ track }: { track: Track }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    void window.fmusic.trackArtworkDataUrl(track.id).then((value) => {
      if (!cancelled) setUrl(value);
    });
    return () => {
      cancelled = true;
    };
  }, [track.id]);
  if (url) return <img src={url} alt="" />;
  return (
    <span className="editor-preview-cover-empty" aria-hidden="true">
      <MusicIcon size={24} />
    </span>
  );
}
