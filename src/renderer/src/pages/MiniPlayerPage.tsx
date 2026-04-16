import { useEffect, useState } from 'react';

interface MiniState {
  title: string | null;
  artist: string | null;
  thumbnailPath: string | null;
  youtubeId: string | null;
  isPlaying: boolean;
  hasPrev: boolean;
  hasNext: boolean;
}

function coverUrl(state: MiniState): string | null {
  if (state.thumbnailPath) return state.thumbnailPath;
  if (state.youtubeId) return `https://i.ytimg.com/vi/${state.youtubeId}/hqdefault.jpg`;
  return null;
}

export function MiniPlayerPage() {
  const [state, setState] = useState<MiniState>({
    title: null,
    artist: null,
    thumbnailPath: null,
    youtubeId: null,
    isPlaying: false,
    hasPrev: false,
    hasNext: false
  });

  useEffect(() => {
    const off = window.fmusic.onMiniState((s) => setState(s));
    // Ask main window to re-broadcast current state immediately.
    window.fmusic.sendMiniCommand('request-state');
    return off;
  }, []);

  const cover = coverUrl(state);
  const send = (cmd: 'toggle-play' | 'prev' | 'next' | 'expand') =>
    window.fmusic.sendMiniCommand(cmd);

  return (
    <div className="mini-player">
      <div className="mini-drag">
        <div className="mini-cover">
          {cover ? <img src={cover} alt="" /> : <span className="mini-cover-empty">♪</span>}
        </div>
        <div className="mini-info">
          <div className="mini-title">{state.title ?? '🎵 Nothing playing'}</div>
          <div className="mini-artist">{state.artist ?? ''}</div>
        </div>
      </div>
      <div className="mini-controls">
        <button
          onClick={() => send('prev')}
          disabled={!state.hasPrev}
          style={{ visibility: state.hasPrev ? 'visible' : 'hidden' }}
          title="Previous"
        >
          ‹‹
        </button>
        <button
          className="primary mini-play"
          onClick={() => send('toggle-play')}
          disabled={!state.title}
          title={state.isPlaying ? 'Pause' : 'Play'}
        >
          {state.isPlaying ? '❚❚' : '▶'}
        </button>
        <button
          onClick={() => send('next')}
          disabled={!state.hasNext}
          style={{ visibility: state.hasNext ? 'visible' : 'hidden' }}
          title="Next"
        >
          ››
        </button>
      </div>
      <button className="mini-expand" onClick={() => send('expand')} title="Open fmusic">
        ⤢
      </button>
    </div>
  );
}
