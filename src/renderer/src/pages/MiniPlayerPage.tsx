import { useEffect, useState } from 'react';
import { useT } from '../i18n';

interface MiniState {
  trackId: number | null;
  title: string | null;
  artist: string | null;
  isPlaying: boolean;
  hasPrev: boolean;
  hasNext: boolean;
}

function coverUrl(state: MiniState): string | null {
  return typeof state.trackId === 'number' ? String(state.trackId) : null;
}

export function MiniPlayerPage() {
  const t = useT();
  const [state, setState] = useState<MiniState>({
    trackId: null,
    title: null,
    artist: null,
    isPlaying: false,
    hasPrev: false,
    hasNext: false
  });
  const [cover, setCover] = useState<string | null>(null);

  useEffect(() => {
    const off = window.fmusic.onMiniState((s) => setState(s));
    window.fmusic.sendMiniCommand('request-state');
    return off;
  }, []);

  useEffect(() => {
    const trackId = coverUrl(state);
    if (!trackId) {
      setCover(null);
      return;
    }
    let cancelled = false;
    setCover(null);
    void window.fmusic.trackArtworkDataUrl(Number(trackId)).then((url) => {
      if (!cancelled) setCover(url);
    });
    return () => {
      cancelled = true;
    };
  }, [state.trackId]);
  const send = (cmd: 'toggle-play' | 'prev' | 'next' | 'expand') =>
    window.fmusic.sendMiniCommand(cmd);

  return (
    <div className="mini-player">
      <div className="mini-drag">
        <div className="mini-cover">
          {cover ? (
            <img src={cover} alt="" />
          ) : (
            <span className="mini-cover-empty">♪</span>
          )}
        </div>
        <div className="mini-info">
          <div className="mini-title">{state.title ?? t('miniPlayer.nothingPlaying')}</div>
          <div className="mini-artist">{state.artist ?? ''}</div>
        </div>
      </div>
      <div className="mini-controls">
        <button
          onClick={() => send('prev')}
          disabled={!state.hasPrev}
          style={{ visibility: state.hasPrev ? 'visible' : 'hidden' }}
          title={t('miniPlayer.previous')}
        >
          ‹‹
        </button>
        <button
          className="primary mini-play"
          onClick={() => send('toggle-play')}
          disabled={!state.title}
          title={state.isPlaying ? t('miniPlayer.pause') : t('miniPlayer.play')}
        >
          {state.isPlaying ? '❚❚' : '▶'}
        </button>
        <button
          onClick={() => send('next')}
          disabled={!state.hasNext}
          style={{ visibility: state.hasNext ? 'visible' : 'hidden' }}
          title={t('miniPlayer.next')}
        >
          ››
        </button>
      </div>
      <button className="mini-expand" onClick={() => send('expand')} title={t('miniPlayer.openFmusic')}>
        ⤢
      </button>
    </div>
  );
}
