import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SonosPanel } from '../components/SonosPanel';
import { usePlayerStore } from '../store/player';
import { useSonosStore } from '../store/sonos';
import type { Track, SonosDevice } from '../../../shared/types';

vi.mock('../store/player');
vi.mock('../store/sonos');
vi.mock('../store/settings', () => ({
  useSettingsStore: vi.fn((selector?: unknown) => {
    const state = { settings: { language: 'en' } };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

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
};

const mockDevices: SonosDevice[] = [
  { name: 'Living Room', host: '192.168.1.10', port: 1400 },
  { name: 'Bedroom', host: '192.168.1.11', port: 1400 },
];

const mockDiscover = vi.fn().mockResolvedValue(undefined);
const mockInitFromCache = vi.fn().mockResolvedValue(undefined);
const mockStartCasting = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockPlayerPause = vi.fn();

function makeSonosState(overrides = {}) {
  return {
    devices: [] as SonosDevice[],
    activeHost: null as string | null,
    discovering: false,
    error: null as string | null,
    isPlaying: false,
    position: 0,
    duration: 0,
    initFromCache: mockInitFromCache,
    discover: mockDiscover,
    startCasting: mockStartCasting,
    stop: mockStop,
    ...overrides,
  };
}

function makePlayerState(overrides = {}) {
  return {
    current: null as Track | null,
    position: 0,
    pause: mockPlayerPause,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(useSonosStore).mockImplementation((selector?: unknown) => {
    const state = makeSonosState();
    return typeof selector === 'function' ? selector(state) : state;
  });
  vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
    const state = makePlayerState();
    return typeof selector === 'function' ? selector(state) : state;
  });
  vi.clearAllMocks();
});

describe('SonosPanel', () => {
  it('renders the cast button', () => {
    render(<SonosPanel />);
    expect(screen.getByTitle('Cast to Sonos')).toBeInTheDocument();
  });

  it('panel is hidden by default', () => {
    render(<SonosPanel />);
    expect(screen.queryByText(/sonos/i)).not.toBeInTheDocument();
  });

  it('opens the panel when the cast button is clicked', async () => {
    render(<SonosPanel />);
    await userEvent.click(screen.getByTitle('Cast to Sonos'));
    expect(screen.getByText(/sonos/i)).toBeInTheDocument();
  });

  it('toggles the panel closed on second click', async () => {
    render(<SonosPanel />);
    const castBtn = screen.getByTitle('Cast to Sonos');
    await userEvent.click(castBtn);
    await userEvent.click(castBtn);
    expect(screen.queryByPlaceholderText('192.168.1.x')).toBeNull();
  });

  it('shows search button when no devices are found', async () => {
    render(<SonosPanel />);
    await userEvent.click(screen.getByTitle('Cast to Sonos'));
    expect(screen.getByRole('button', { name: /search for devices/i })).toBeInTheDocument();
  });

  it('calls discover when search button is clicked', async () => {
    render(<SonosPanel />);
    await userEvent.click(screen.getByTitle('Cast to Sonos'));
    await userEvent.click(screen.getByRole('button', { name: /search for devices/i }));
    expect(mockDiscover).toHaveBeenCalledOnce();
  });

  it('shows discovered devices', async () => {
    vi.mocked(useSonosStore).mockImplementation((selector?: unknown) => {
      const state = makeSonosState({ devices: mockDevices });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<SonosPanel />);
    await userEvent.click(screen.getByTitle('Cast to Sonos'));
    expect(screen.getByText('Living Room')).toBeInTheDocument();
    expect(screen.getByText('Bedroom')).toBeInTheDocument();
  });

  it('disables device cast button when no track is loaded', async () => {
    vi.mocked(useSonosStore).mockImplementation((selector?: unknown) => {
      const state = makeSonosState({ devices: mockDevices });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<SonosPanel />);
    await userEvent.click(screen.getByTitle('Cast to Sonos'));
    const castBtns = screen.getAllByTitle('Play here');
    castBtns.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('calls startCasting when a device is clicked with a loaded track', async () => {
    vi.mocked(useSonosStore).mockImplementation((selector?: unknown) => {
      const state = makeSonosState({ devices: mockDevices });
      return typeof selector === 'function' ? selector(state) : state;
    });
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<SonosPanel />);
    await userEvent.click(screen.getByTitle('Cast to Sonos'));
    await userEvent.click(screen.getAllByTitle('Play here')[0]);
    expect(mockStartCasting).toHaveBeenCalledWith(
      '192.168.1.10',
      mockTrack.id,
      mockTrack.title,
      mockTrack.artist,
      undefined
    );
  });

  it('shows an error message when there is an error', async () => {
    vi.mocked(useSonosStore).mockImplementation((selector?: unknown) => {
      const state = makeSonosState({ error: 'Connection refused' });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<SonosPanel />);
    await userEvent.click(screen.getByTitle('Cast to Sonos'));
    expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
  });

  it('renders the add-by-IP input', async () => {
    render(<SonosPanel />);
    await userEvent.click(screen.getByTitle('Cast to Sonos'));
    expect(screen.getByPlaceholderText('192.168.1.x')).toBeInTheDocument();
  });

  it('add button is disabled when IP input is empty', async () => {
    render(<SonosPanel />);
    await userEvent.click(screen.getByTitle('Cast to Sonos'));
    const addBtn = screen.getByRole('button', { name: /add/i });
    expect(addBtn).toBeDisabled();
  });

  it('calls sonosAddByIp when a valid IP is entered and Add is clicked', async () => {
    render(<SonosPanel />);
    await userEvent.click(screen.getByTitle('Cast to Sonos'));
    await userEvent.type(screen.getByPlaceholderText('192.168.1.x'), '192.168.1.50');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(window.fmusic.sonosAddByIp).toHaveBeenCalledWith('192.168.1.50');
  });

  it('submits add-by-IP on Enter key', async () => {
    render(<SonosPanel />);
    await userEvent.click(screen.getByTitle('Cast to Sonos'));
    const input = screen.getByPlaceholderText('192.168.1.x');
    await userEvent.type(input, '192.168.1.50{Enter}');
    expect(window.fmusic.sonosAddByIp).toHaveBeenCalledWith('192.168.1.50');
  });

  it('shows error when sonosAddByIp fails', async () => {
    vi.mocked(window.fmusic.sonosAddByIp).mockRejectedValue(new Error('Device not found'));
    render(<SonosPanel />);
    await userEvent.click(screen.getByTitle('Cast to Sonos'));
    await userEvent.type(screen.getByPlaceholderText('192.168.1.x'), '192.168.1.50');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    await waitFor(() => {
      expect(screen.getByText(/device not found/i)).toBeInTheDocument();
    });
  });

  it('calls sonosStop when stop button is clicked', async () => {
    vi.mocked(useSonosStore).mockImplementation((selector?: unknown) => {
      const state = makeSonosState({ devices: mockDevices });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<SonosPanel />);
    await userEvent.click(screen.getByTitle('Cast to Sonos'));
    const stopBtns = screen.getAllByTitle('Stop this device');
    fireEvent.click(stopBtns[0]);
    await waitFor(() => {
      expect(window.fmusic.sonosStop).toHaveBeenCalledWith('192.168.1.10');
    });
  });

  it('loads devices from cache when the panel first opens', async () => {
    render(<SonosPanel />);
    await userEvent.click(screen.getByTitle('Cast to Sonos'));
    await waitFor(() => {
      expect(mockInitFromCache).toHaveBeenCalledOnce();
    });
  });
});
