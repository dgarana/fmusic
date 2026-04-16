import { useEffect, useState } from 'react';
import { usePlayerStore } from '../store/player';
import { useLibraryStore } from '../store/library';
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
    isPlaying,
    position,
    duration,
    volume,
    togglePlay,
    next,
    prev,
    seek,
    setVolume
  } = usePlayerStore();

  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < queue.length - 1;

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
            onClick={() => void prev()}
            title="Anterior"
            style={{ visibility: hasPrev ? 'visible' : 'hidden' }}
          >
            &laquo;
          </button>
          <button
            className="primary"
            onClick={togglePlay}
            disabled={!current}
            title={isPlaying ? 'Pausar' : 'Reproducir'}
          >
            {isPlaying ? '\u275a\u275a' : '\u25b6'}
          </button>
          <button
            onClick={() => void next()}
            title="Siguiente"
            style={{ visibility: hasNext ? 'visible' : 'hidden' }}
          >
            &raquo;
          </button>
        </div>
        <div className="scrub">
          <span>{formatDuration(position)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.5}
            value={position}
            onChange={(e) => seek(Number(e.target.value))}
            disabled={!current}
          />
          <span>{formatDuration(duration || current?.durationSec || 0)}</span>
        </div>
      </div>
      <div className="player-extras">
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Volumen</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          style={{ width: 120 }}
        />
      </div>
    </footer>
  );
}
