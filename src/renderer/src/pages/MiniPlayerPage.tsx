import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { formatDuration } from '../util';
import {
  PrevIcon,
  NextIcon,
  PlayIcon,
  PauseIcon,
  ExpandIcon,
  MusicIcon
} from '../components/icons';

interface MiniState {
  trackId: number | null;
  title: string | null;
  artist: string | null;
  isPlaying: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  position: number;
  duration: number;
}

const INITIAL_STATE: MiniState = {
  trackId: null,
  title: null,
  artist: null,
  isPlaying: false,
  hasPrev: false,
  hasNext: false,
  position: 0,
  duration: 0
};

export function MiniPlayerPage() {
  const t = useT();
  const [state, setState] = useState<MiniState>(INITIAL_STATE);
  const [cover, setCover] = useState<string | null>(null);

  // Local scrub state: while the user drags the slider we show the dragged
  // value, ignoring live position updates so the thumb doesn't jump.
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);

  useEffect(() => {
    const off = window.fmusic.onMiniState((s) => setState(s));
    window.fmusic.sendMiniCommand('request-state');
    return off;
  }, []);

  useEffect(() => {
    if (state.trackId === null) {
      setCover(null);
      return;
    }
    let cancelled = false;
    setCover(null);
    void window.fmusic.trackArtworkDataUrl(state.trackId).then((url) => {
      if (!cancelled) setCover(url);
    });
    return () => {
      cancelled = true;
    };
  }, [state.trackId]);

  const send = (cmd: 'toggle-play' | 'prev' | 'next' | 'expand') =>
    window.fmusic.sendMiniCommand(cmd);

  const displayPosition = scrubbing ? scrubValue : state.position;
  const maxDuration = state.duration || 0;
  const canSeek = state.trackId !== null && maxDuration > 0;
  const scrubProgress =
    maxDuration > 0
      ? Math.min(Math.max(displayPosition / maxDuration, 0), 1) * 100
      : 0;

  function handleScrubStart() {
    if (!canSeek) return;
    setScrubValue(state.position);
    setScrubbing(true);
  }
  function handleScrubChange(e: React.ChangeEvent<HTMLInputElement>) {
    setScrubValue(Number(e.target.value));
  }
  function handleScrubEnd(
    e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>
  ) {
    const seconds = Number((e.target as HTMLInputElement).value);
    setScrubbing(false);
    if (canSeek) window.fmusic.sendMiniSeek(seconds);
  }

  return (
    <div className="mini-player">
      <div className="mini-top">
        <div className="mini-drag">
          <div className="mini-cover">
            {cover ? (
              <img src={cover} alt="" />
            ) : (
              <span className="mini-cover-empty">
                <MusicIcon size={22} />
              </span>
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
            <PrevIcon size={16} />
          </button>
          <button
            className="primary mini-play"
            onClick={() => send('toggle-play')}
            disabled={!state.title}
            title={state.isPlaying ? t('miniPlayer.pause') : t('miniPlayer.play')}
          >
            {state.isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          </button>
          <button
            onClick={() => send('next')}
            disabled={!state.hasNext}
            style={{ visibility: state.hasNext ? 'visible' : 'hidden' }}
            title={t('miniPlayer.next')}
          >
            <NextIcon size={16} />
          </button>
        </div>
        <button className="mini-expand" onClick={() => send('expand')} title={t('miniPlayer.openFmusic')}>
          <ExpandIcon size={16} />
        </button>
      </div>
      <div className="mini-scrub">
        <span className="mini-time">{formatDuration(displayPosition)}</span>
        <input
          type="range"
          min={0}
          max={maxDuration || 1}
          step={0.5}
          value={Math.min(displayPosition, maxDuration || 0)}
          disabled={!canSeek}
          onMouseDown={handleScrubStart}
          onTouchStart={handleScrubStart}
          onChange={handleScrubChange}
          onMouseUp={handleScrubEnd}
          onTouchEnd={handleScrubEnd}
          style={{ ['--range-progress' as string]: `${scrubProgress}%` }}
        />
        <span className="mini-time">{formatDuration(maxDuration)}</span>
      </div>
    </div>
  );
}
