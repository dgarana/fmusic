import { usePlayerStore } from '../store/player';
import { formatDuration } from '../util';

export function PlayerBar() {
  const {
    current,
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

  return (
    <footer className="player-bar">
      <div className="player-current">
        <div className="cover">
          {current?.thumbnailPath ? <img src={current.thumbnailPath} alt="" /> : null}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="title">{current?.title ?? 'Nada reproduci\u00e9ndose'}</div>
          <div className="artist">{current?.artist ?? ''}</div>
        </div>
      </div>
      <div className="player-controls">
        <div className="buttons">
          <button onClick={() => void prev()} disabled={!current} title="Anterior">
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
          <button onClick={() => void next()} disabled={!current} title="Siguiente">
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
