import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/player';
import { useLibraryStore } from '../store/library';

export function MobileBridge() {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.index);

  const playTrack = usePlayerStore((s) => s.playTrack);
  const enqueue = usePlayerStore((s) => s.enqueue);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const pause = usePlayerStore((s) => s.pause);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const tracks = useLibraryStore((s) => s.tracks);

  // Broadcast meaningful state changes (track, play/pause, queue, volume) immediately.
  useEffect(() => {
    window.fmusic.sendPlayerState({
      current,
      isPlaying,
      position: usePlayerStore.getState().position,
      duration,
      volume,
      queue,
      queueIndex
    });
  }, [current, isPlaying, duration, volume, queue, queueIndex]);

  // Broadcast position updates every second so the seek bar stays in sync.
  const posTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    posTimerRef.current = setInterval(() => {
      const s = usePlayerStore.getState();
      window.fmusic.sendPlayerState({
        current: s.current,
        isPlaying: s.isPlaying,
        position: s.position,
        duration: s.duration,
        volume: s.volume,
        queue: s.queue,
        queueIndex: s.index
      });
    }, 1000);
    return () => {
      if (posTimerRef.current !== null) clearInterval(posTimerRef.current);
    };
  }, []);

  // Handle commands coming from mobile clients via WebSocket → main → renderer.
  useEffect(() => {
    return window.fmusic.onMobileCommand((cmd) => {
      switch (cmd.type) {
        case 'play':
          togglePlay();
          break;
        case 'pause':
          pause();
          break;
        case 'next':
          void next();
          break;
        case 'prev':
          void prev();
          break;
        case 'seek':
          seek(cmd.position);
          break;
        case 'volume':
          setVolume(cmd.value);
          break;
        case 'play-track': {
          const track = tracks.find((t) => t.id === cmd.trackId);
          if (track) void playTrack(track, tracks);
          break;
        }
        case 'enqueue': {
          const track = tracks.find((t) => t.id === cmd.trackId);
          if (track) enqueue(track);
          break;
        }
      }
    });
  }, [togglePlay, pause, next, prev, seek, setVolume, playTrack, enqueue, tracks]);

  return null;
}
