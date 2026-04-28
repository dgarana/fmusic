import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockNext, mockPlayerGetState } = vi.hoisted(() => ({
  mockNext: vi.fn().mockResolvedValue(undefined),
  mockPlayerGetState: vi.fn()
}));

vi.mock('../store/player', () => ({
  usePlayerStore: {
    getState: mockPlayerGetState
  }
}));

vi.mock('../store/settings', () => ({
  useSettingsStore: {
    getState: () => ({
      settings: { language: 'en' }
    })
  }
}));

import { useSonosStore } from '../store/sonos';

describe('useSonosStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockPlayerGetState.mockReturnValue({
      queue: [],
      index: -1,
      current: null,
      next: mockNext
    });
    useSonosStore.getState().stopPositionPolling();
    useSonosStore.setState({
      devices: [],
      activeHost: '192.168.1.23',
      isPlaying: true,
      position: 0,
      duration: 0,
      transportState: 'PLAYING',
      discovering: false,
      error: null
    });
  });

  afterEach(() => {
    useSonosStore.getState().stopPositionPolling();
    vi.useRealTimers();
  });

  it('advances to the next queued track when Sonos stops at the end of playback', async () => {
    mockPlayerGetState.mockReturnValue({
      queue: [{ id: 1 }, { id: 2 }],
      index: 0,
      current: { id: 1 },
      next: mockNext
    });
    vi.mocked(window.fmusic.sonosGetPosition)
      .mockResolvedValueOnce({
        position: 199,
        duration: 200,
        transportState: 'PLAYING'
      })
      .mockResolvedValueOnce({
        position: 0,
        duration: 200,
        transportState: 'STOPPED'
      });

    useSonosStore.getState().startPositionPolling();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('does not advance when Sonos stops before the track reaches the end', async () => {
    mockPlayerGetState.mockReturnValue({
      queue: [{ id: 1 }, { id: 2 }],
      index: 0,
      current: { id: 1 },
      next: mockNext
    });
    vi.mocked(window.fmusic.sonosGetPosition).mockResolvedValue({
      position: 35,
      duration: 200,
      transportState: 'STOPPED'
    });

    useSonosStore.getState().startPositionPolling();
    await vi.advanceTimersByTimeAsync(500);

    expect(mockNext).not.toHaveBeenCalled();
    expect(useSonosStore.getState().isPlaying).toBe(false);
  });

  it('syncs volume when starting to cast', async () => {
    mockPlayerGetState.mockReturnValue({
      volume: 0.75
    });

    await useSonosStore.getState().startCasting('192.168.1.50', 123);

    expect(window.fmusic.sonosSetVolume).toHaveBeenCalledWith('192.168.1.50', 0.75);
  });
});
