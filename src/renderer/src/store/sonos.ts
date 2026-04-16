import { create } from 'zustand';
import type { SonosDevice } from '../../../shared/types';

interface SonosState {
  devices: SonosDevice[];
  activeHost: string | null;
  isPlaying: boolean;
  discovering: boolean;
  error: string | null;

  discover: () => Promise<void>;
  stopAll: () => Promise<void>;
  startCasting: (host: string, trackId: number, title?: string, artist?: string) => Promise<void>;
  sendTrack: (trackId: number, title?: string, artist?: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  togglePlay: () => Promise<void>;
  stop: () => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  seek: (seconds: number) => Promise<void>;
}

export const useSonosStore = create<SonosState>((set, get) => ({
  devices: [],
  activeHost: null,
  isPlaying: false,
  discovering: false,
  error: null,

  async discover() {
    set({ discovering: true, error: null });
    try {
      const devices = await window.fmusic.sonosDiscover();
      set({ devices });
      if (devices.length === 0) set({ error: 'No se encontraron dispositivos Sonos en la red.' });
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

  async startCasting(host, trackId, title, artist) {
    set({ error: null });
    try {
      await window.fmusic.sonosPlay(host, trackId, title, artist);
      set({ activeHost: host, isPlaying: true });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async sendTrack(trackId, title, artist) {
    const { activeHost } = get();
    if (!activeHost) return;
    try {
      await window.fmusic.sonosPlay(activeHost, trackId, title, artist);
      set({ isPlaying: true });
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
    const { activeHost } = get();
    if (!activeHost) return;
    try {
      await window.fmusic.sonosStop(activeHost);
    } catch {
      // ignore
    }
    set({ activeHost: null, isPlaying: false });
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
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  }
}));
