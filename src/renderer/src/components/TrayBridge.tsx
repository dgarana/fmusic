import { useEffect } from 'react';
import { usePlayerStore } from '../store/player';
import { useSonosStore } from '../store/sonos';

/**
 * Keeps the tray menu and the mini-player window in sync with the current
 * playback state, regardless of whether the audio is coming from the local
 * Howl or a Sonos speaker. Also routes commands issued from the tray or
 * mini-player back to the right sink.
 */
export function TrayBridge() {
  const current = usePlayerStore((s) => s.current);
  const localIsPlaying = usePlayerStore((s) => s.isPlaying);
  const playerPosition = usePlayerStore((s) => s.position);
  const playerDuration = usePlayerStore((s) => s.duration);
  const index = usePlayerStore((s) => s.index);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const seek = usePlayerStore((s) => s.seek);

  const sonosActiveHost = useSonosStore((s) => s.activeHost);
  const sonosIsPlaying = useSonosStore((s) => s.isPlaying);
  const sonosPosition = useSonosStore((s) => s.position);
  const sonosDuration = useSonosStore((s) => s.duration);
  const sonosTogglePlay = useSonosStore((s) => s.togglePlay);
  const sonosSeek = useSonosStore((s) => s.seek);

  const isCasting = sonosActiveHost !== null;
  const isPlaying = isCasting ? sonosIsPlaying : localIsPlaying;
  const position = isCasting ? sonosPosition : playerPosition;
  const duration = isCasting
    ? sonosDuration || current?.durationSec || 0
    : playerDuration || current?.durationSec || 0;

  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < queueLength - 1;

  // Tray menu: updated only when the top-level fields change. We don't
  // include `position` here because the tray menu has no scrubbing, and
  // rebuilding it every 500ms is wasteful.
  useEffect(() => {
    window.fmusic.sendTrayState({
      title: current?.title ?? null,
      artist: current?.artist ?? null,
      isPlaying,
      hasPrev,
      hasNext
    });
  }, [current?.id, isPlaying, hasPrev, hasNext]);

  // Mini player: a real audio player, so it needs every tick (position +
  // duration). Sending state is a cheap IPC, so we accept firing every
  // time the position advances.
  useEffect(() => {
    window.fmusic.sendMiniState({
      trackId: current?.id ?? null,
      title: current?.title ?? null,
      artist: current?.artist ?? null,
      isPlaying,
      hasPrev,
      hasNext,
      position,
      duration
    });
  }, [current?.id, isPlaying, hasPrev, hasNext, position, duration]);

  // Commands from the tray or mini player. Route them to Sonos when
  // casting so pause/next work on the speaker; otherwise they hit the
  // local player.
  useEffect(() => {
    return window.fmusic.onTrayCommand((cmd) => {
      if (cmd === 'toggle-play') {
        if (isCasting) void sonosTogglePlay();
        else togglePlay();
      } else if (cmd === 'next') {
        void next();
      } else if (cmd === 'prev') {
        void prev();
      }
    });
  }, [isCasting, togglePlay, next, prev, sonosTogglePlay]);

  // Seek events coming from the mini player's scrub bar.
  useEffect(() => {
    return window.fmusic.onMiniSeek((seconds) => {
      if (isCasting) {
        void sonosSeek(seconds);
      } else {
        seek(seconds);
      }
    });
  }, [isCasting, seek, sonosSeek]);

  return null;
}
