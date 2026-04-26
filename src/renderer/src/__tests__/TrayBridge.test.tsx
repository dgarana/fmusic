import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrayBridge } from '../components/TrayBridge';
import { usePlayerStore } from '../store/player';
import { useSonosStore } from '../store/sonos';
import { useDownloadsStore } from '../store/downloads';
import { useSettingsStore } from '../store/settings';
import type { Track } from '../../../shared/types';

vi.mock('../store/player');
vi.mock('../store/sonos');
vi.mock('../store/downloads');
vi.mock('../store/settings');

const mockTrack: Track = {
  id: 1,
  title: 'Test Track',
  artist: 'Test Artist',
  album: null,
  genre: null,
  durationSec: 200,
  filePath: '/music/test.mp3',
  thumbnailPath: null,
  youtubeId: 'abc123',
  downloadedAt: '2024-01-01',
  playCount: 0,
  lastPlayedAt: null,
  sourceUrl: null,
};

const mockNext = vi.fn().mockResolvedValue(undefined);
const mockPrev = vi.fn().mockResolvedValue(undefined);
const mockTogglePlay = vi.fn();
const mockSeek = vi.fn();
const mockPlayTrack = vi.fn().mockResolvedValue(undefined);
const mockEnqueue = vi.fn();
const mockSetVolume = vi.fn();
const mockSonosTogglePlay = vi.fn().mockResolvedValue(undefined);
const mockSonosSeek = vi.fn().mockResolvedValue(undefined);
const mockSonosInitFromCache = vi.fn().mockResolvedValue(undefined);
const mockSonosDiscover = vi.fn().mockResolvedValue(undefined);
const mockSonosStartCasting = vi.fn().mockResolvedValue(undefined);
const mockSonosStop = vi.fn().mockResolvedValue(undefined);
const mockSonosStopAll = vi.fn().mockResolvedValue(undefined);

function makeState(overrides = {}) {
  return {
    current: null,
    isPlaying: false,
    index: -1,
    queue: [] as Track[],
    position: 0,
    duration: 0,
    volume: 1,
    next: mockNext,
    prev: mockPrev,
    togglePlay: mockTogglePlay,
    seek: mockSeek,
    playTrack: mockPlayTrack,
    enqueue: mockEnqueue,
    setVolume: mockSetVolume,
    ...overrides,
  };
}

function makeSonosState(overrides = {}) {
  return {
    activeHost: null as string | null,
    isPlaying: false,
    position: 0,
    duration: 0,
    transportState: null as string | null,
    devices: [] as Array<{ name: string; host: string; port: number }>,
    discovering: false,
    error: null as string | null,
    togglePlay: mockSonosTogglePlay,
    seek: mockSonosSeek,
    initFromCache: mockSonosInitFromCache,
    discover: mockSonosDiscover,
    startCasting: mockSonosStartCasting,
    stop: mockSonosStop,
    stopAll: mockSonosStopAll,
    ...overrides,
  };
}

function makeDownloadsState(overrides = {}) {
  return {
    jobs: [],
    ...overrides
  };
}

function makeSettingsState(overrides = {}) {
  return {
    settings: { sonosEnabled: true },
    ...overrides
  };
}

beforeEach(() => {
  vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
    const state = makeState();
    return typeof selector === 'function' ? selector(state) : state;
  });
  vi.mocked(useSonosStore).mockImplementation((selector?: unknown) => {
    const state = makeSonosState();
    return typeof selector === 'function' ? selector(state) : state;
  });
  vi.mocked(useDownloadsStore).mockImplementation((selector?: unknown) => {
    const state = makeDownloadsState();
    return typeof selector === 'function' ? selector(state) : state;
  });
  vi.mocked(useSettingsStore).mockImplementation((selector?: unknown) => {
    const state = makeSettingsState();
    return typeof selector === 'function' ? selector(state) : state;
  });
  vi.mocked(window.fmusic.onMiniSeek).mockReturnValue(() => {});
  vi.mocked(window.fmusic.onRemoteCommand).mockReturnValue(() => {});
  vi.mocked(window.fmusic.onRemoteSeek).mockReturnValue(() => {});
  vi.mocked(window.fmusic.onRemoteVolume).mockReturnValue(() => {});
  vi.clearAllMocks();
});

describe('TrayBridge', () => {
  it('renders nothing to the DOM', () => {
    const { container } = render(<TrayBridge />);
    expect(container.firstChild).toBeNull();
  });

  it('sends initial tray state on mount', () => {
    render(<TrayBridge />);
    expect(window.fmusic.sendTrayState).toHaveBeenCalledWith({
      title: null,
      artist: null,
      isPlaying: false,
      hasPrev: false,
      hasNext: false,
    });
  });

  it('sends initial mini state on mount', () => {
    render(<TrayBridge />);
    expect(window.fmusic.sendMiniState).toHaveBeenCalledWith({
      trackId: null,
      title: null,
      artist: null,
      isPlaying: false,
      hasPrev: false,
      hasNext: false,
      position: 0,
      duration: 0
    });
  });

  it('sends tray state with current track info when playing', () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makeState({ current: mockTrack, isPlaying: true, index: 1, queue: [mockTrack, mockTrack, mockTrack] });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<TrayBridge />);
    expect(window.fmusic.sendTrayState).toHaveBeenCalledWith({
      title: 'Test Track',
      artist: 'Test Artist',
      isPlaying: true,
      hasPrev: true,
      hasNext: true,
    });
  });

  it('registers a tray command listener on mount', () => {
    render(<TrayBridge />);
    expect(window.fmusic.onTrayCommand).toHaveBeenCalled();
  });

  it('calls togglePlay when tray emits toggle-play', () => {
    let capturedHandler: ((cmd: string) => void) | null = null;
    vi.mocked(window.fmusic.onTrayCommand).mockImplementation((handler) => {
      capturedHandler = handler as (cmd: string) => void;
      return () => {};
    });
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makeState({ togglePlay: mockTogglePlay });
      return typeof selector === 'function' ? selector(state) : state;
    });

    render(<TrayBridge />);
    capturedHandler!('toggle-play');
    expect(mockTogglePlay).toHaveBeenCalledOnce();
  });

  it('calls next when tray emits next', () => {
    let capturedHandler: ((cmd: string) => void) | null = null;
    vi.mocked(window.fmusic.onTrayCommand).mockImplementation((handler) => {
      capturedHandler = handler as (cmd: string) => void;
      return () => {};
    });
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makeState({ next: mockNext });
      return typeof selector === 'function' ? selector(state) : state;
    });

    render(<TrayBridge />);
    capturedHandler!('next');
    expect(mockNext).toHaveBeenCalledOnce();
  });

  it('calls prev when tray emits prev', () => {
    let capturedHandler: ((cmd: string) => void) | null = null;
    vi.mocked(window.fmusic.onTrayCommand).mockImplementation((handler) => {
      capturedHandler = handler as (cmd: string) => void;
      return () => {};
    });
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makeState({ prev: mockPrev });
      return typeof selector === 'function' ? selector(state) : state;
    });

    render(<TrayBridge />);
    capturedHandler!('prev');
    expect(mockPrev).toHaveBeenCalledOnce();
  });
});
