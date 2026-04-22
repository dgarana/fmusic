import { Howl } from 'howler';
import { create } from 'zustand';
import type { Track } from '../../../shared/types';
import { useSonosStore } from './sonos';

interface PlayerState {
  queue: Track[];
  index: number;
  current: Track | null;
  isPlaying: boolean;
  position: number; // seconds
  duration: number;
  volume: number;
  howl: Howl | null;
  tickerId: number | null;

  playTrack: (track: Track, queue?: Track[]) => Promise<void>;
  enqueue: (track: Track) => void;
  playFromIndex: (index: number, options?: { startAt?: number }) => Promise<void>;
  pause: () => void;
  togglePlay: () => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
}

function stop(howl: Howl | null, tickerId: number | null) {
  if (tickerId !== null) {
    window.clearInterval(tickerId);
  }
  if (howl) {
    howl.stop();
    howl.unload();
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  index: -1,
  current: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  volume: 0.9,
  howl: null,
  tickerId: null,

  async playTrack(track, queue) {
    const nextQueue = queue ?? [track];
    const nextIndex = nextQueue.findIndex((t) => t.id === track.id);
    set({ queue: nextQueue, index: nextIndex >= 0 ? nextIndex : 0 });
    await get().playFromIndex(nextIndex >= 0 ? nextIndex : 0);
  },

  enqueue(track) {
    const { queue, current } = get();
    if (queue.length === 0 && !current) {
      set({
        queue: [track],
        index: 0,
        current: track,
        isPlaying: false,
        position: 0,
        duration: track.durationSec ?? 0
      });
      return;
    }
    set({ queue: [...queue, track] });
  },

  async playFromIndex(index, options = {}) {
    const { queue, howl, tickerId, volume } = get();
    if (index < 0 || index >= queue.length) return;
    const track = queue[index];
    const startAt = options.startAt && options.startAt > 0 ? options.startAt : 0;

    stop(howl, tickerId);

    // When Sonos is the active audio sink, skip starting the local Howl
    // entirely. We still advance the queue state and update `current` so
    // the UI (PlayerBar, NowPlayingIndicator, …) reflects the right
    // track; the PlayerBar's effect forwards the change to Sonos.
    // Without this guard, clicking "Next" while casting would double up
    // playback locally and on the speaker.
    if (useSonosStore.getState().activeHost !== null) {
      set({
        howl: null,
        tickerId: null,
        current: track,
        index,
        isPlaying: true,
        position: 0,
        duration: track.durationSec ?? 0
      });
      window.fmusic.markTrackPlayed(track.id).catch(() => {});
      return;
    }

    const url = await window.fmusic.trackStreamUrl(track.id);
    if (!url) {
      console.error('[player] No stream URL for track', track.id);
      return;
    }

    const nextHowl = new Howl({
      src: [url],
      html5: true,
      volume,
      format: ['mp3', 'm4a', 'opus']
    });

    nextHowl.once('load', () => {
      set({ duration: nextHowl.duration() });
      // Howler's seek() is only reliable once the source has loaded; when
      // we're resuming from a Sonos handoff this is how we jump to the
      // position the speaker was at.
      if (startAt > 0) {
        nextHowl.seek(startAt);
        set({ position: startAt });
      }
    });

    nextHowl.on('end', () => {
      void get().next();
    });

    nextHowl.play();
    window.fmusic.markTrackPlayed(track.id).catch(() => {});

    const newTickerId = window.setInterval(() => {
      const raw = nextHowl.seek();
      const pos = typeof raw === 'number' ? raw : 0;
      set({ position: pos });
    }, 500);

    set({
      howl: nextHowl,
      current: track,
      index,
      isPlaying: true,
      position: startAt,
      tickerId: newTickerId
    });
  },

  pause() {
    const { howl } = get();
    if (!howl) return;
    howl.pause();
    set({ isPlaying: false });
  },

  togglePlay() {
    const { howl, isPlaying, current, index } = get();
    // The queue finished on the last track, or Sonos is the sink: the
    // local Howl is null but `current` is still set. Hitting play should
    // restart the current track (locally or, if casting, via Sonos via
    // playFromIndex, which branches on activeHost).
    if (!howl && current && index >= 0) {
      void get().playFromIndex(index);
      return;
    }
    if (!howl) return;
    if (isPlaying) {
      howl.pause();
      set({ isPlaying: false });
    } else {
      howl.play();
      set({ isPlaying: true });
    }
  },

  async next() {
    const { index, queue } = get();
    if (index + 1 < queue.length) {
      await get().playFromIndex(index + 1);
    } else {
      // End of queue: tear down the audio resource but keep `current` so
      // the UI still shows the last track and the user can replay it by
      // clicking play again.
      const { howl, tickerId } = get();
      stop(howl, tickerId);
      set({ isPlaying: false, howl: null, tickerId: null, position: 0 });
    }
  },

  async prev() {
    const { index, position } = get();
    if (position > 3 || index === 0) {
      get().seek(0);
      return;
    }
    await get().playFromIndex(index - 1);
  },

  seek(seconds) {
    const { howl } = get();
    if (!howl) return;
    howl.seek(seconds);
    set({ position: seconds });
  },

  setVolume(volume) {
    const { howl } = get();
    if (howl) howl.volume(volume);
    set({ volume });
  }
}));
