import { create } from 'zustand';
import type { SonosDevice } from '../../../shared/types';
import { usePlayerStore } from './player';

interface SonosState {
  devices: SonosDevice[];
  activeHost: string | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  discovering: boolean;
  error: string | null;

  initFromCache: () => Promise<void>;
  discover: () => Promise<void>;
  stopAll: () => Promise<void>;
  startCasting: (host: string, trackId: number, title?: string, artist?: string, seekTo?: number) => Promise<void>;
  sendTrack: (trackId: number, title?: string, artist?: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  togglePlay: () => Promise<void>;
  stop: () => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  seek: (seconds: number) => Promise<void>;
  startPositionPolling: () => void;
  stopPositionPolling: () => void;
}

let positionPollerId: ReturnType<typeof setInterval> | null = null;

export const useSonosStore = create<SonosState>((set, get) => ({
  devices: [],
  activeHost: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  discovering: false,
  error: null,

  async initFromCache() {
    try {
      const devices = await window.fmusic.sonosInitFromCache();
      if (devices.length > 0) set({ devices });
    } catch {
      // cache init is best-effort, ignore errors
    }
  },

  async discover() {
    set({ discovering: true, error: null });
    try {
      const devices = await window.fmusic.sonosDiscover();
      set({ devices });
      if (devices.length === 0) set({ error: 'No Sonos devices found on the network.' });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ discovering: false });
    }
  },

  async stopAll() {
    set({ discovering: true, error: null });
    try {
      const devices = await window.fmusic.sonosDiscover();
      set({ devices });
      await Promise.allSettled(devices.map((d) => window.fmusic.sonosStop(d.host)));
      set({ activeHost: null, isPlaying: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ discovering: false });
    }
  },

  async startCasting(host, trackId, title, artist, seekTo) {
    set({ error: null });
    try {
      await window.fmusic.sonosPlay(host, trackId, title, artist);
      set({ activeHost: host, isPlaying: true, position: seekTo ?? 0, duration: 0 });
      get().startPositionPolling();
      if (seekTo && seekTo > 0) {
        // Sonos needs time to buffer before accepting a seek
        await new Promise((r) => setTimeout(r, 1500));
        await window.fmusic.sonosSeek(host, seekTo);
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async sendTrack(trackId, title, artist) {
    const { activeHost } = get();
    if (!activeHost) return;
    try {
      await window.fmusic.sonosPlay(activeHost, trackId, title, artist);
      set({ isPlaying: true, position: 0, duration: 0 });
      get().startPositionPolling();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async pause() {
    const { activeHost } = get();
    if (!activeHost) return;
    try {
      await window.fmusic.sonosPause(activeHost);
      set({ isPlaying: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async resume() {
    const { activeHost } = get();
    if (!activeHost) return;
    try {
      await window.fmusic.sonosResume(activeHost);
      set({ isPlaying: true });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async togglePlay() {
    const { isPlaying } = get();
    if (isPlaying) {
      await get().pause();
    } else {
      await get().resume();
    }
  },

  async stop() {
    const { activeHost, position } = get();
    if (!activeHost) return;
    get().stopPositionPolling();
    try {
      await window.fmusic.sonosStop(activeHost);
    } catch {
      // ignore
    }
    // Capture where the Sonos speaker was before we clear the state so we
    // can pick up local playback from the same point — the user expects
    // "stop casting" to mean "continue here", not "throw the song away".
    const resumeAt = Math.max(0, position);
    set({ activeHost: null, isPlaying: false, position: 0, duration: 0 });

    const player = usePlayerStore.getState();
    if (player.current && player.index >= 0) {
      await player.playFromIndex(player.index, { startAt: resumeAt });
    }
  },

  async setVolume(volume) {
    const { activeHost } = get();
    if (!activeHost) return;
    try {
      await window.fmusic.sonosSetVolume(activeHost, volume);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async seek(seconds) {
    const { activeHost } = get();
    if (!activeHost) return;
    try {
      await window.fmusic.sonosSeek(activeHost, seconds);
      set({ position: seconds });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  startPositionPolling() {
    if (positionPollerId !== null) return;
    let lastTickTime = Date.now();
    positionPollerId = setInterval(async () => {
      const { activeHost, isPlaying } = get();
      if (!activeHost) {
        get().stopPositionPolling();
        return;
      }
      const now = Date.now();
      const elapsed = (now - lastTickTime) / 1000;
      lastTickTime = now;
      try {
        const { position, duration } = await window.fmusic.sonosGetPosition(activeHost);
        set({ position, duration });
      } catch {
        // Sonos can be in a transitioning state (buffering, seeking) where
        // GetPositionInfo throws. Advance position locally so the scrubber
        // never freezes.
        if (isPlaying) {
          set((s) => ({ position: s.position + elapsed }));
        }
      }
    }, 500);
  },

  stopPositionPolling() {
    if (positionPollerId !== null) {
      clearInterval(positionPollerId);
      positionPollerId = null;
    }
  }
}));
