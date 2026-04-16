import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../store/player';
import { useLibraryStore } from '../store/library';
import { useSonosStore } from '../store/sonos';
import { SonosPanel } from './SonosPanel';
import { formatDuration } from '../util';

function coverUrl(current: { thumbnailPath: string | null; youtubeId: string | null } | null): string | null {
  if (!current) return null;
  if (current.thumbnailPath) return current.thumbnailPath;
  if (current.youtubeId) return `https://i.ytimg.com/vi/${current.youtubeId}/hqdefault.jpg`;
  return null;
}

export function PlayerBar() {
  const {
    current,
    queue,
    index,
    isPlaying: localPlaying,
    position,
    duration,
    volume,
    togglePlay: localToggle,
    next: localNext,
    prev: localPrev,
    seek,
    setVolume: localSetVolume
  } = usePlayerStore();

  const sonos = useSonosStore();
  const isCasting = sonos.activeHost !== null;

  // When casting and the local player advances to a new track, forward it to Sonos.
  const prevTrackId = useRef<number | null>(null);
  useEffect(() => {
    if (!isCasting || !current) return;
    if (current.id !== prevTrackId.current) {
      prevTrackId.current = current.id;
      void sonos.sendTrack(current.id, current.title ?? undefined, current.artist ?? undefined);
    }
  }, [current?.id, isCasting]);

  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < queue.length - 1;

  // Controls: route to Sonos when casting, otherwise local.
  const isPlaying = isCasting ? sonos.isPlaying : localPlaying;

  function handleTogglePlay() {
    if (isCasting) {
      void sonos.togglePlay();
    } else {
      localToggle();
    }
  }

  async function handleNext() {
    await localNext(); // advances the queue index + updates current
    // useEffect above will forward the new track to Sonos automatically
  }

  async function handlePrev() {
    await localPrev();
  }

  function handleVolume(v: number) {
    localSetVolume(v);
    if (isCasting) void sonos.setVolume(v);
  }

  const { playlists, refreshPlaylists } = useLibraryStore();
  const [isFavorited, setIsFavorited] = useState(false);
  const favoritesPlaylist = playlists.find((p) => p.name === 'Favoritos');

  useEffect(() => {
    if (!current || !favoritesPlaylist) {
      setIsFavorited(false);
      return;
    }
    window.fmusic.playlistsForTrack(current.id).then((trackPlaylists) => {
      setIsFavorited(trackPlaylists.some((p) => p.id === favoritesPlaylist.id));
    });
  }, [current?.id, favoritesPlaylist?.id]);

  async function toggleFavorite() {
    if (!current || !favoritesPlaylist) return;
    if (isFavorited) {
      await window.fmusic.removeTrackFromPlaylist(favoritesPlaylist.id, current.id);
    } else {
      await window.fmusic.addTrackToPlaylist(favoritesPlaylist.id, current.id);
    }
    setIsFavorited(!isFavorited);
    await refreshPlaylists();
  }

  const cover = coverUrl(current);

  // Local scrub state: while dragging, show the drag value instead of live position.
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const livePosition = isCasting ? sonos.position : position;
  const displayPosition = scrubbing ? scrubValue : livePosition;
  const maxDuration = isCasting
    ? (sonos.duration || current?.durationSec || 0)
    : (duration || current?.durationSec || 0);

  function handleScrubStart() {
    setScrubValue(livePosition);
    setScrubbing(true);
  }
  function handleScrubChange(e: React.ChangeEvent<HTMLInputElement>) {
    setScrubValue(Number(e.target.value));
  }
  function handleScrubEnd(e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) {
    const s = Number((e.target as HTMLInputElement).value);
    setScrubbing(false);
    seek(s);
    if (isCasting) void sonos.seek(s);
  }

  return (
    <footer className="player-bar">
      <div className="player-current">
        <div className="cover">
          {cover ? <img src={cover} alt="" /> : null}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="title">{current?.title ?? 'Nada reproduciéndose'}</div>
          <div className="artist">{current?.artist ?? ''}</div>
        </div>
        <button
          className={`heart-btn${isFavorited ? ' is-favorited' : ''}`}
          onClick={() => void toggleFavorite()}
          disabled={!current || !favoritesPlaylist}
          title={isFavorited ? 'Quitar de Favoritos' : 'Añadir a Favoritos'}
        >
          {isFavorited ? '♥' : '♡'}
        </button>
      </div>
      <div className="player-controls">
        <div className="buttons">
          <button
            onClick={() => void handlePrev()}
            title="Anterior"
            style={{ visibility: hasPrev ? 'visible' : 'hidden' }}
          >
            &laquo;
          </button>
          <button
            className="primary"
            onClick={handleTogglePlay}
            disabled={!current}
            title={isPlaying ? 'Pausar' : 'Reproducir'}
          >
            {isPlaying ? '\u275a\u275a' : '\u25b6'}
          </button>
          <button
            onClick={() => void handleNext()}
            title="Siguiente"
            style={{ visibility: hasNext ? 'visible' : 'hidden' }}
          >
            &raquo;
          </button>
        </div>
        <div className="scrub">
          <span>{formatDuration(displayPosition)}</span>
          <input
            type="range"
            min={0}
            max={maxDuration}
            step={0.5}
            value={displayPosition}
            onMouseDown={handleScrubStart}
            onTouchStart={handleScrubStart}
            onChange={handleScrubChange}
            onMouseUp={handleScrubEnd}
            onTouchEnd={handleScrubEnd}
            disabled={!current}
          />
          <span>{formatDuration(maxDuration)}</span>
        </div>
      </div>
      <div className="player-extras">
        <SonosPanel />
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Volumen</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => handleVolume(Number(e.target.value))}
          style={{ width: 120 }}
        />
      </div>
    </footer>
  );
}
