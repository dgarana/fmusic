import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PlaylistsPage } from '../pages/PlaylistsPage';
import { useLibraryStore } from '../store/library';
import type { Playlist } from '../../../shared/types';

vi.mock('../store/library');
vi.mock('../store/settings', () => ({
  useSettingsStore: vi.fn((selector?: unknown) => {
    const state = { settings: { language: 'en' } };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

const mockRefreshPlaylists = vi.fn().mockResolvedValue(undefined);
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

function renderPlaylistsPage() {
  return render(
    <MemoryRouter initialEntries={['/playlists']}>
      <Routes>
        <Route path="/playlists" element={<PlaylistsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useLibraryStore).mockImplementation((selector?: unknown) => {
    const state = {
      playlists: mockPlaylists,
      refreshPlaylists: mockRefreshPlaylists,
    };
    return typeof selector === 'function' ? selector(state) : state;
  });
  vi.mocked(window.fmusic.renamePlaylist).mockResolvedValue(mockPlaylists[1]);
});

describe('PlaylistsPage', () => {
  it('shows rename only for user-created playlists', () => {
    renderPlaylistsPage();
    expect(screen.getAllByRole('button', { name: 'Rename' })).toHaveLength(1);
  });

  it('trims names before renaming a playlist', async () => {
    renderPlaylistsPage();
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Playlist name' }), {
      target: { value: '  Evening Mix  ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(window.fmusic.renamePlaylist).toHaveBeenCalledWith(2, 'Evening Mix');
    });
    expect(mockRefreshPlaylists).toHaveBeenCalled();
  });

  it('prevents empty playlist names when renaming', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    renderPlaylistsPage();
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Playlist name' }), {
      target: { value: '   ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(window.fmusic.renamePlaylist).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Playlist name cannot be empty.');
  });

  it('shows a friendly duplicate-name error', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.mocked(window.fmusic.renamePlaylist).mockRejectedValue(
      new Error('SqliteError: UNIQUE constraint failed: playlists.name')
    );

    renderPlaylistsPage();
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Playlist name' }), {
      target: { value: 'Favorites' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('A playlist named "Favorites" already exists.');
    });
    expect(mockRefreshPlaylists).not.toHaveBeenCalled();
  });
});
