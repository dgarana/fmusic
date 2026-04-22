import { create } from 'zustand';
import type { Playlist, Track, TrackQuery } from '../../../shared/types';

interface LibraryState {
  tracks: Track[];
  genres: string[];
  playlists: Playlist[];
  playlistsVersion: number;
  query: TrackQuery;

  setQuery: (patch: Partial<TrackQuery>) => Promise<void>;
  refreshTracks: () => Promise<void>;
  refreshGenres: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
  refreshAll: () => Promise<void>;
  handleTrackAdded: (track: Track) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  tracks: [],
  genres: [],
  playlists: [],
  playlistsVersion: 0,
  query: { sortBy: 'downloadedAt', sortDir: 'desc' },

  async setQuery(patch) {
    const query = { ...get().query, ...patch };
    set({ query });
    await get().refreshTracks();
  },

  async refreshTracks() {
    const tracks = await window.fmusic.listTracks(get().query);
    set({ tracks });
  },

  async refreshGenres() {
    const genres = await window.fmusic.listGenres();
    set({ genres });
  },

  async refreshPlaylists() {
    const playlists = await window.fmusic.listPlaylists();
    set((s) => ({ playlists, playlistsVersion: s.playlistsVersion + 1 }));
  },

  async refreshAll() {
    await Promise.all([
      get().refreshTracks(),
      get().refreshGenres(),
      get().refreshPlaylists()
    ]);
  },

  handleTrackAdded(_track) {
    // Simplest approach: refresh list. Could be optimized to insert in-place.
    void get().refreshTracks();
    void get().refreshGenres();
    void get().refreshPlaylists();
  }
}));
