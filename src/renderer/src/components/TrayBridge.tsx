import { useEffect } from 'react';
import { usePlayerStore } from '../store/player';

export function TrayBridge() {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const index = usePlayerStore((s) => s.index);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < queueLength - 1;

  // Sync state to tray menu + mini player.
  useEffect(() => {
    const state = {
      title: current?.title ?? null,
      artist: current?.artist ?? null,
      isPlaying,
      hasPrev,
      hasNext
    };
    window.fmusic.sendTrayState(state);
    window.fmusic.sendMiniState({
      ...state,
      thumbnailPath: current?.thumbnailPath ?? null,
      youtubeId: current?.youtubeId ?? null
    });
  }, [current?.id, current?.thumbnailPath, current?.youtubeId, isPlaying, hasPrev, hasNext]);

  // Listen for commands from tray or mini player.
  useEffect(() => {
    return window.fmusic.onTrayCommand((cmd) => {
      if (cmd === 'toggle-play') togglePlay();
      if (cmd === 'next') void next();
      if (cmd === 'prev') void prev();
    });
  }, [togglePlay, next, prev]);

  return null;
}
