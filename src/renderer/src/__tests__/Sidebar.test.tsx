import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { useLibraryStore } from '../store/library';
import type { Playlist } from '../../../shared/types';

vi.mock('../store/library');
vi.mock('../store/settings', () => ({
  useSettingsStore: vi.fn((selector?: unknown) => {
    const state = { settings: { language: 'en' } };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

const mockPlaylists: Playlist[] = [
  {
    id: 1,
    name: 'Favorites',
    slug: 'favorites',
    createdAt: '2024-01-01',
    coverPath: null,
    trackCount: 5,
    kind: 'manual',
    smartDefinition: null,
    sourceUrl: null
  },
  {
    id: 2,
    name: 'Road Trip',
    slug: null,
    createdAt: '2024-01-02',
    coverPath: null,
    trackCount: 12,
    kind: 'manual',
    smartDefinition: null,
    sourceUrl: null
  },
];

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/library']}>
      <Sidebar />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.mocked(useLibraryStore).mockImplementation((selector?: unknown) => {
    const state = { playlists: [] as Playlist[] };
    return typeof selector === 'function' ? selector(state) : state;
  });
  vi.mocked(window.fmusic.getAppVersion).mockResolvedValue('1.0.0');
  vi.mocked(window.fmusic.getUpdaterStatus).mockResolvedValue({ status: 'idle' });
  vi.mocked(window.fmusic.onUpdaterStatus).mockReturnValue(() => {});
});

describe('Sidebar', () => {
  it('renders the brand logo', () => {
    renderSidebar();
    expect(screen.getByAltText('FMusic')).toBeInTheDocument();
  });

  it('renders all main navigation links', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /download/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /library/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /playlists/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument();
  });

  it('shows empty state when there are no playlists', () => {
    renderSidebar();
    expect(screen.getByText(/no playlists yet/i)).toBeInTheDocument();
  });

  it('renders playlists from the store', () => {
    vi.mocked(useLibraryStore).mockImplementation((selector?: unknown) => {
      const state = { playlists: mockPlaylists };
      return typeof selector === 'function' ? selector(state) : state;
    });
    renderSidebar();
    expect(screen.getByText('Road Trip')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders the built-in Favorites playlist with translated name', () => {
    vi.mocked(useLibraryStore).mockImplementation((selector?: unknown) => {
      const state = { playlists: mockPlaylists };
      return typeof selector === 'function' ? selector(state) : state;
    });
    renderSidebar();
    expect(screen.getByText('Favorites')).toBeInTheDocument();
  });

  it('shows the app version after it loads', async () => {
    renderSidebar();
    await waitFor(() => {
      expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    });
  });

  it('hides version when getAppVersion rejects', async () => {
    vi.mocked(window.fmusic.getAppVersion).mockRejectedValue(new Error('fail'));
    renderSidebar();
    await waitFor(() => {
      expect(screen.queryByText(/^v/)).toBeNull();
    });
  });

  it('shows update available badge', async () => {
    vi.mocked(window.fmusic.getUpdaterStatus).mockResolvedValue({ status: 'available', version: '2.0.0' });
    renderSidebar();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /2\.0\.0/i })).toBeInTheDocument();
    });
  });

  it('shows downloading badge with percentage', async () => {
    vi.mocked(window.fmusic.getUpdaterStatus).mockResolvedValue({ status: 'downloading', percent: 42 });
    renderSidebar();
    await waitFor(() => {
      expect(screen.getByText(/42/)).toBeInTheDocument();
    });
  });

  it('shows install-ready badge', async () => {
    vi.mocked(window.fmusic.getUpdaterStatus).mockResolvedValue({ status: 'ready', version: '2.0.0' });
    renderSidebar();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /restart/i })).toBeInTheDocument();
    });
  });

  it('shows error badge with manual download link', async () => {
    vi.mocked(window.fmusic.getUpdaterStatus).mockResolvedValue({ status: 'error', message: 'network error' });
    renderSidebar();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /download manually/i })).toBeInTheDocument();
    });
  });

  it('calls downloadUpdate when available badge is clicked', async () => {
    vi.mocked(window.fmusic.getUpdaterStatus).mockResolvedValue({ status: 'available', version: '2.0.0' });
    renderSidebar();
    const btn = await screen.findByRole('button', { name: /2\.0\.0/i });
    btn.click();
    expect(window.fmusic.downloadUpdate).toHaveBeenCalled();
  });

  it('calls installUpdate when ready badge is clicked', async () => {
    vi.mocked(window.fmusic.getUpdaterStatus).mockResolvedValue({ status: 'ready', version: '2.0.0' });
    renderSidebar();
    const btn = await screen.findByRole('button', { name: /restart/i });
    btn.click();
    expect(window.fmusic.installUpdate).toHaveBeenCalled();
  });
});
