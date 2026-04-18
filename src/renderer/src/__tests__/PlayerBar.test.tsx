import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlayerBar } from '../components/PlayerBar';
import { usePlayerStore } from '../store/player';
import { useLibraryStore } from '../store/library';
import { useSonosStore } from '../store/sonos';
import type { Track, Playlist } from '../../../shared/types';

vi.mock('../store/player');
vi.mock('../store/library');
vi.mock('../store/sonos');
vi.mock('../store/settings', () => ({
  useSettingsStore: vi.fn((selector?: unknown) => {
    const state = { settings: { language: 'en', sonosEnabled: false } };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

const mockTrack: Track = {
  id: 42,
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  album: 'A Night at the Opera',
  genre: 'Rock',
  durationSec: 354,
  filePath: '/music/queen.mp3',
  thumbnailPath: null,
  youtubeId: 'fJ9rUzIMcZQ',
  downloadedAt: '2024-01-01',
  playCount: 5,
  lastPlayedAt: '2024-01-10',
};

const favoritesPlaylist: Playlist = {
  id: 10,
  name: 'Favorites',
  slug: 'favorites',
  createdAt: '2024-01-01',
  coverPath: null,
  trackCount: 3,
};

const mockTogglePlay = vi.fn();
const mockNext = vi.fn().mockResolvedValue(undefined);
const mockPrev = vi.fn().mockResolvedValue(undefined);
const mockSeek = vi.fn();
const mockSetVolume = vi.fn();
const mockRefreshPlaylists = vi.fn().mockResolvedValue(undefined);

function makePlayerState(overrides = {}) {
  return {
    current: null as Track | null,
    queue: [] as Track[],
    index: -1,
    isPlaying: false,
    position: 0,
    duration: 0,
    volume: 0.9,
    togglePlay: mockTogglePlay,
    next: mockNext,
    prev: mockPrev,
    seek: mockSeek,
    setVolume: mockSetVolume,
    pause: vi.fn(),
    ...overrides,
  };
}

function makeSonosState(overrides = {}) {
  return {
    activeHost: null as string | null,
    isPlaying: false,
    position: 0,
    duration: 0,
    togglePlay: vi.fn().mockResolvedValue(undefined),
    setVolume: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    sendTrack: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeLibraryState(overrides = {}) {
  return {
    playlists: [] as Playlist[],
    refreshPlaylists: mockRefreshPlaylists,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
    const state = makePlayerState();
    return typeof selector === 'function' ? selector(state) : state;
  });
  vi.mocked(useSonosStore).mockImplementation((selector?: unknown) => {
    const state = makeSonosState();
    return typeof selector === 'function' ? selector(state) : state;
  });
  vi.mocked(useLibraryStore).mockImplementation((selector?: unknown) => {
    const state = makeLibraryState();
    return typeof selector === 'function' ? selector(state) : state;
  });
  vi.clearAllMocks();
});

describe('PlayerBar', () => {
  it('renders the player bar footer', () => {
    render(<PlayerBar />);
    expect(document.querySelector('footer.player-bar')).toBeInTheDocument();
  });

  it('shows "nothing playing" when no track is loaded', () => {
    render(<PlayerBar />);
    expect(screen.getByText(/nothing playing/i)).toBeInTheDocument();
  });

  it('shows current track title and artist', () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<PlayerBar />);
    expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
    expect(screen.getByText('Queen')).toBeInTheDocument();
  });

  it('shows embedded artwork route when track is loaded', () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<PlayerBar />);
    const img = document.querySelector('.cover img') as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toContain('fmusic-media://artwork/42');
  });

  it('play button is disabled when no track is loaded', () => {
    render(<PlayerBar />);
    expect(screen.getByTitle(/play/i)).toBeDisabled();
  });

  it('shows play icon when not playing', () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack, isPlaying: false });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<PlayerBar />);
    expect(screen.getByTitle(/^play$/i)).toBeInTheDocument();
  });

  it('shows pause icon when playing', () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack, isPlaying: true });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<PlayerBar />);
    expect(screen.getByTitle(/pause/i)).toBeInTheDocument();
  });

  it('calls togglePlay when play button is clicked', () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack, togglePlay: mockTogglePlay });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<PlayerBar />);
    fireEvent.click(screen.getByTitle(/^play$/i));
    expect(mockTogglePlay).toHaveBeenCalledOnce();
  });

  it('hides previous button when at the start of the queue', () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack, index: 0, queue: [mockTrack] });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<PlayerBar />);
    const prevBtn = screen.getByTitle(/previous/i);
    expect(prevBtn).toHaveStyle({ visibility: 'hidden' });
  });

  it('shows previous button when not at the start of the queue', () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack, index: 1, queue: [mockTrack, mockTrack] });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<PlayerBar />);
    expect(screen.getByTitle(/previous/i)).toHaveStyle({ visibility: 'visible' });
  });

  it('hides next button when at the end of the queue', () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack, index: 0, queue: [mockTrack] });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<PlayerBar />);
    expect(screen.getByTitle(/next/i)).toHaveStyle({ visibility: 'hidden' });
  });

  it('shows next button when there are tracks ahead', () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack, index: 0, queue: [mockTrack, mockTrack] });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<PlayerBar />);
    expect(screen.getByTitle(/next/i)).toHaveStyle({ visibility: 'visible' });
  });

  it('renders the volume slider', () => {
    render(<PlayerBar />);
    const sliders = screen.getAllByRole('slider');
    const volumeSlider = sliders.find((s) => (s as HTMLInputElement).max === '1');
    expect(volumeSlider).toBeInTheDocument();
  });

  it('volume slider reflects the current volume', () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ volume: 0.5 });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<PlayerBar />);
    const sliders = screen.getAllByRole('slider');
    const volumeSlider = sliders.find((s) => (s as HTMLInputElement).max === '1') as HTMLInputElement;
    expect(volumeSlider.value).toBe('0.5');
  });

  it('heart button is disabled when no track is loaded', () => {
    render(<PlayerBar />);
    expect(document.querySelector('.heart-btn')).toBeDisabled();
  });

  it('heart button is disabled when favorites playlist is missing', () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack });
      return typeof selector === 'function' ? selector(state) : state;
    });
    vi.mocked(useLibraryStore).mockImplementation((selector?: unknown) => {
      const state = makeLibraryState({ playlists: [] });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<PlayerBar />);
    expect(document.querySelector('.heart-btn')).toBeDisabled();
  });

  it('heart button is enabled when a track and favorites playlist exist', async () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack });
      return typeof selector === 'function' ? selector(state) : state;
    });
    vi.mocked(useLibraryStore).mockImplementation((selector?: unknown) => {
      const state = makeLibraryState({ playlists: [favoritesPlaylist] });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<PlayerBar />);
    await waitFor(() => {
      expect(document.querySelector('.heart-btn')).not.toBeDisabled();
    });
  });

  it('adds track to favorites when heart button is clicked', async () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack });
      return typeof selector === 'function' ? selector(state) : state;
    });
    vi.mocked(useLibraryStore).mockImplementation((selector?: unknown) => {
      const state = makeLibraryState({ playlists: [favoritesPlaylist] });
      return typeof selector === 'function' ? selector(state) : state;
    });
    vi.mocked(window.fmusic.playlistsForTrack).mockResolvedValue([]);

    render(<PlayerBar />);
    const heartBtn = await screen.findByTitle('Add to Favorites');
    fireEvent.click(heartBtn);

    await waitFor(() => {
      expect(window.fmusic.addTrackToPlaylist).toHaveBeenCalledWith(favoritesPlaylist.id, mockTrack.id);
    });
  });

  it('removes track from favorites when heart is already active', async () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack });
      return typeof selector === 'function' ? selector(state) : state;
    });
    vi.mocked(useLibraryStore).mockImplementation((selector?: unknown) => {
      const state = makeLibraryState({ playlists: [favoritesPlaylist] });
      return typeof selector === 'function' ? selector(state) : state;
    });
    vi.mocked(window.fmusic.playlistsForTrack).mockResolvedValue([favoritesPlaylist]);

    render(<PlayerBar />);
    const heartBtn = await screen.findByTitle('Remove from Favorites');
    fireEvent.click(heartBtn);

    await waitFor(() => {
      expect(window.fmusic.removeTrackFromPlaylist).toHaveBeenCalledWith(favoritesPlaylist.id, mockTrack.id);
    });
  });

  it('formats and displays the current position', () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack, position: 90 });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<PlayerBar />);
    expect(screen.getByText('1:30')).toBeInTheDocument();
  });

  it('formats and displays the track duration', () => {
    vi.mocked(usePlayerStore).mockImplementation((selector?: unknown) => {
      const state = makePlayerState({ current: mockTrack, duration: 354 });
      return typeof selector === 'function' ? selector(state) : state;
    });
    render(<PlayerBar />);
    expect(screen.getByText('5:54')).toBeInTheDocument();
  });
});
