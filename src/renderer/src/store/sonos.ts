import { create } from 'zustand';
import type { SonosDevice, SonosTransportState } from '../../../shared/types';
import { translate } from '../i18n';
import { usePlayerStore } from './player';
import { useSettingsStore } from './settings';

const t = (key: string) => {
  const locale = (useSettingsStore.getState().settings?.language ?? 'en') as any;
  return translate(locale, key);
};

interface SonosState {
  devices: SonosDevice[];
  activeHost: string | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  transportState: SonosTransportState | null;
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
const END_OF_TRACK_GRACE_SEC = 2;

function isTransportPlaying(state: SonosTransportState | null | undefined): boolean {
  return state === 'PLAYING' || state === 'TRANSITIONING';
}

export const useSonosStore = create<SonosState>((set, get) => ({
  devices: [],
  activeHost: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  transportState: null,
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
      if (devices.length === 0) set({ error: t('sonos.noDevicesFound') });
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
      set({ activeHost: null, isPlaying: false, position: 0, duration: 0, transportState: null });
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
      set({
        activeHost: host,
        isPlaying: true,
        position: seekTo ?? 0,
        duration: 0,
        transportState: 'TRANSITIONING'
      });
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
      set({ isPlaying: true, position: 0, duration: 0, transportState: 'TRANSITIONING' });
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
      set({ isPlaying: false, transportState: 'PAUSED_PLAYBACK' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('SONOS_STALE_SESSION')) {
        get().stopPositionPolling();
        set({
          activeHost: null,
          isPlaying: false,
          position: 0,
          duration: 0,
          transportState: null,
          error: t('sonos.sessionExpired')
        });
      } else {
        set({ error: msg });
      }
    }
  },

  async resume() {
    const { activeHost } = get();
    if (!activeHost) return;
    try {
      await window.fmusic.sonosResume(activeHost);
      set({ isPlaying: true, transportState: 'PLAYING' });
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
    set({ activeHost: null, isPlaying: false, position: 0, duration: 0, transportState: null });

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
    let wasNearTrackEnd = false;
    let trackIdNearEnd: number | null = null;
    let advancingQueue = false;
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
        const { position, duration, transportState } = await window.fmusic.sonosGetPosition(activeHost);
        const transportPlaying = isTransportPlaying(transportState);
        const nearTrackEnd =
          duration > 0 && position >= Math.max(0, duration - END_OF_TRACK_GRACE_SEC);

        if (!advancingQueue && transportState === 'STOPPED' && wasNearTrackEnd) {
          const player = usePlayerStore.getState();
          const shouldAdvance =
            trackIdNearEnd !== null &&
            player.current?.id === trackIdNearEnd &&
            player.index + 1 < player.queue.length;
          wasNearTrackEnd = false;
          trackIdNearEnd = null;
          if (shouldAdvance) {
            advancingQueue = true;
            try {
              await player.next();
            } finally {
              advancingQueue = false;
            }
            return;
          }
        }

        wasNearTrackEnd = transportPlaying && nearTrackEnd;
        trackIdNearEnd = wasNearTrackEnd ? usePlayerStore.getState().current?.id ?? null : null;
        set({ position, duration, isPlaying: transportPlaying, transportState });
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
