import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../store/player';
import { useLibraryStore } from '../store/library';
import { useSonosStore } from '../store/sonos';
import { useSettingsStore } from '../store/settings';
import { SonosPanel } from './SonosPanel';
import { formatDuration, offsetSeekPosition } from '../util';
import { useT, playlistDisplayName } from '../i18n';
import {
  PrevIcon,
  NextIcon,
  SeekBackIcon,
  SeekForwardIcon,
  PlayIcon,
  PauseIcon,
  HeartIcon,
  HeartFilledIcon,
  VolumeIcon
} from './icons';

function coverUrl(trackId: number | null | undefined): string | null {
  return typeof trackId === 'number' ? `fmusic-media://artwork/${trackId}` : null;
}

export function PlayerBar() {
  const t = useT();
  const sonosEnabled = useSettingsStore((s) => s.settings?.sonosEnabled ?? true);
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
    seekBy: localSeekBy,
    setVolume: localSetVolume
  } = usePlayerStore();

  const sonos = useSonosStore();
  const isCasting = sonos.activeHost !== null;

  // If sonos is disabled while casting, stop it and revert to local playback
  useEffect(() => {
    if (!sonosEnabled && isCasting) {
      void sonos.stop();
    }
  }, [sonosEnabled, isCasting, sonos]);

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
  }

  function handleSeekTo(seconds: number) {
    if (isCasting) {
      void sonos.seek(seconds);
    } else {
      seek(seconds);
    }
  }

  function handleQuickSeek(delta: number) {
    if (!current) return;
    setScrubbing(false);
    setScrubValue(offsetSeekPosition(displayPosition, delta, maxDuration));
    if (isCasting) {
      void sonos.seekBy(delta);
    } else {
      localSeekBy(delta);
    }
  }

  const { playlists, refreshPlaylists } = useLibraryStore();
  const [isFavorited, setIsFavorited] = useState(false);
  const favoritesPlaylist = playlists.find((p) => p.slug === 'favorites');
  const favoritesName = favoritesPlaylist ? playlistDisplayName(favoritesPlaylist, t) : '';

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

  const cover = coverUrl(current?.id);

  // Local scrub state: while dragging, show the drag value instead of live position.
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const livePosition = isCasting ? sonos.position : position;
  const displayPosition = scrubbing ? scrubValue : livePosition;
  const maxDuration = isCasting
    ? (sonos.duration || current?.durationSec || 0)
    : (duration || current?.durationSec || 0);

  // Percentage of the filled portion of each slider. Exposed through the
  // --range-progress CSS variable so the track paints itself with the
  // active theme's accent up to the current value.
  const scrubProgress =
    maxDuration > 0 ? Math.min(Math.max(displayPosition / maxDuration, 0), 1) * 100 : 0;
  const volumeProgress = Math.min(Math.max(volume, 0), 1) * 100;

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
    handleSeekTo(s);
  }

  return (
    <footer className="player-bar">
      <div className="player-current">
        <div className="cover">
          {cover ? <img src={cover} alt="" /> : null}
        </div>
        <div className="min-w-0">
          <div className="title">{current?.title ?? t('player.nothingPlaying')}</div>
          <div className="artist">{current?.artist ?? ''}</div>
        </div>
        <button
          className={`heart-btn${isFavorited ? ' is-favorited' : ''}`}
          onClick={() => void toggleFavorite()}
          disabled={!current || !favoritesPlaylist}
          title={
            isFavorited
              ? t('player.removeFromFavorites', { name: favoritesName })
              : t('player.addToFavorites', { name: favoritesName })
          }
        >
          {isFavorited ? <HeartFilledIcon size={18} /> : <HeartIcon size={18} />}
        </button>
      </div>
      <div className="player-controls">
        <div className="buttons">
          <button
            className={`icon-btn ${hasPrev ? 'visible' : 'hidden'}`}
            onClick={() => void handlePrev()}
            title={t('player.previous')}
          >
            <PrevIcon size={20} />
          </button>
          <button
            className="icon-btn seek-jump-btn"
            onClick={() => handleQuickSeek(-10)}
            disabled={!current}
            title={t('player.seekBack10')}
            aria-label={t('player.seekBack10')}
          >
            <SeekBackIcon size={17} />
          </button>
          <button
            className="play-btn"
            onClick={handleTogglePlay}
            disabled={!current}
            title={isPlaying ? t('player.pause') : t('player.play')}
          >
            {isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </button>
          <button
            className="icon-btn seek-jump-btn"
            onClick={() => handleQuickSeek(10)}
            disabled={!current}
            title={t('player.seekForward10')}
            aria-label={t('player.seekForward10')}
          >
            <SeekForwardIcon size={17} />
          </button>
          <button
            className={`icon-btn ${hasNext ? 'visible' : 'hidden'}`}
            onClick={() => void handleNext()}
            title={t('player.next')}
          >
            <NextIcon size={20} />
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
            style={{ ['--range-progress' as string]: `${scrubProgress}%` }}
          />
          <span>{formatDuration(maxDuration)}</span>
        </div>
      </div>
      <div className="player-extras">
        {sonosEnabled && <SonosPanel />}
        <div className="volume" title={t('player.volume')}>
          <VolumeIcon size={18} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => handleVolume(Number(e.target.value))}
            aria-label={t('player.volume')}
            style={{ ['--range-progress' as string]: `${volumeProgress}%` }}
          />
        </div>
      </div>
    </footer>
  );
}
