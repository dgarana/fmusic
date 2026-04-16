import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels.js';
import type {
  AppSettings,
  DependencyStatus,
  DownloadJob,
  DownloadRequest,
  Playlist,
  SearchResult,
  Track,
  TrackQuery
} from '../shared/types.js';

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

function on<T>(channel: string, handler: (payload: T) => void): () => void {
  const wrapped = (_evt: unknown, payload: T) => handler(payload);
  ipcRenderer.on(channel, wrapped as Parameters<typeof ipcRenderer.on>[1]);
  return () => ipcRenderer.off(channel, wrapped as Parameters<typeof ipcRenderer.on>[1]);
}

const api = {
  // App / system
  openExternal: (url: string) => invoke<void>(Channels.OpenExternal, url),
  openPath: (p: string) => invoke<void>(Channels.OpenPath, p),
  pickDirectory: () => invoke<string | null>(Channels.PickDirectory),

  // Dependencies
  depsStatus: () => invoke<DependencyStatus>(Channels.DepsStatus),
  updateYtDlp: () => invoke<{ path: string; version: string | null }>(Channels.DepsUpdateYtDlp),

  // Settings
  getSettings: () => invoke<AppSettings>(Channels.SettingsGet),
  updateSettings: (patch: Partial<AppSettings>) =>
    invoke<AppSettings>(Channels.SettingsUpdate, patch),

  // YouTube
  search: (query: string, limit = 10) => invoke<SearchResult[]>(Channels.YtSearch, query, limit),
  videoInfo: (url: string) =>
    invoke<{
      id: string;
      title: string;
      channel: string;
      durationSec: number | null;
      thumbnail: string | null;
      url: string;
    }>(Channels.YtInfo, url),

  // Downloads
  enqueueDownload: (req: DownloadRequest) => invoke<DownloadJob>(Channels.DownloadEnqueue, req),
  cancelDownload: (id: string) => invoke<boolean>(Channels.DownloadCancel, id),
  listDownloads: () => invoke<DownloadJob[]>(Channels.DownloadList),
  onDownloadUpdate: (handler: (job: DownloadJob) => void) =>
    on<DownloadJob>(Channels.DownloadJobUpdate, handler),

  // Tracks
  listTracks: (query?: TrackQuery) => invoke<Track[]>(Channels.TracksList, query),
  listGenres: () => invoke<string[]>(Channels.TracksGenres),
  updateTrack: (
    id: number,
    patch: Partial<Pick<Track, 'title' | 'artist' | 'album' | 'genre'>>
  ) => invoke<Track | null>(Channels.TracksUpdate, id, patch),
  deleteTrack: (id: number, deleteFile = false) =>
    invoke<boolean>(Channels.TracksDelete, id, deleteFile),
  markTrackPlayed: (id: number) => invoke<void>(Channels.TracksPlayed, id),
  trackStreamUrl: (id: number) => invoke<string | null>(Channels.TracksStream, id),
  onTrackAdded: (handler: (track: Track) => void) => on<Track>(Channels.TracksAdded, handler),

  // Playlists
  listPlaylists: () => invoke<Playlist[]>(Channels.PlaylistsList),
  createPlaylist: (name: string) => invoke<Playlist>(Channels.PlaylistsCreate, name),
  renamePlaylist: (id: number, name: string) =>
    invoke<Playlist | null>(Channels.PlaylistsRename, id, name),
  deletePlaylist: (id: number) => invoke<boolean>(Channels.PlaylistsDelete, id),
  addTrackToPlaylist: (playlistId: number, trackId: number) =>
    invoke<void>(Channels.PlaylistsAddTrack, playlistId, trackId),
  removeTrackFromPlaylist: (playlistId: number, trackId: number) =>
    invoke<void>(Channels.PlaylistsRemoveTrack, playlistId, trackId),
  reorderPlaylist: (playlistId: number, orderedTrackIds: number[]) =>
    invoke<void>(Channels.PlaylistsReorder, playlistId, orderedTrackIds),

  // Schema
  schemaHistory: () =>
    invoke<Array<{ version: number; name: string; applied_at: string }>>(Channels.SchemaHistory)
};

export type FmusicAPI = typeof api;

contextBridge.exposeInMainWorld('fmusic', api);
