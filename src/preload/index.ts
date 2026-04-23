import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../shared/channels.js';
import type {
  AppSettings,
  DependencyStatus,
  DownloadJob,
  DownloadRequest,
  Playlist,
  SmartPlaylistDefinition,
  RemoteControllerCommand,
  RemoteControllerInfo,
  RemotePlayerSnapshot,
  SearchResult,
  SonosDevice,
  Track,
  TrackEditOptions,
  TrackMetadataLookupResult,
  TrackMetadataSuggestions,
  TrackQuery,
  UpdateStatus,
  YoutubePlaylistFetch
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
  getAppVersion: () => invoke<string>(Channels.AppVersion),
  getPlatform: () => invoke<string>(Channels.AppPlatform),
  openExternal: (url: string) => invoke<void>(Channels.OpenExternal, url),

  // Updater
  checkForUpdates: () => invoke<void>(Channels.UpdaterCheck),
  getUpdaterStatus: () => invoke<UpdateStatus>(Channels.UpdaterGetStatus),
  downloadUpdate: () => invoke<void>(Channels.UpdaterDownload),
  installUpdate: () => invoke<void>(Channels.UpdaterInstall),
  onUpdaterStatus: (handler: (status: UpdateStatus) => void) =>
    on<UpdateStatus>(Channels.UpdaterStatus, handler),
  openPath: (p: string) => invoke<void>(Channels.OpenPath, p),
  pickDirectory: () => invoke<string | null>(Channels.PickDirectory),

  // Dependencies
  depsStatus: () => invoke<DependencyStatus>(Channels.DepsStatus),
  depsVersion: () => invoke<string | null>(Channels.DepsVersion),
  updateYtDlp: () => invoke<{ path: string }>(Channels.DepsUpdateYtDlp),

  // Settings
  getSettings: () => invoke<AppSettings>(Channels.SettingsGet),
  updateSettings: (patch: Partial<AppSettings>) =>
    invoke<AppSettings>(Channels.SettingsUpdate, patch),
  onSettingsChanged: (handler: (settings: AppSettings) => void) =>
    on<AppSettings>(Channels.SettingsChanged, handler),

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
      artist: string | null;
      album: string | null;
      track: string | null;
      genre: string | null;
      releaseYear: number | null;
    }>(Channels.YtInfo, url),
  ytStreamUrl: (url: string) => invoke<string>(Channels.YtStreamUrl, url),
  fetchYoutubePlaylist: (url: string) =>
    invoke<YoutubePlaylistFetch>(Channels.YtPlaylist, url),

  // Downloads
  enqueueDownload: (req: DownloadRequest) => invoke<DownloadJob>(Channels.DownloadEnqueue, req),
  cancelDownload: (id: string) => invoke<boolean>(Channels.DownloadCancel, id),
  listDownloads: () => invoke<DownloadJob[]>(Channels.DownloadList),
  onDownloadUpdate: (handler: (job: DownloadJob) => void) =>
    on<DownloadJob>(Channels.DownloadJobUpdate, handler),

  // Tracks
  listTracks: (query?: TrackQuery) => invoke<Track[]>(Channels.TracksList, query),
  listGenres: () => invoke<string[]>(Channels.TracksGenres),
  trackMetadataSuggestions: () =>
    invoke<TrackMetadataSuggestions>(Channels.TracksMetadataSuggestions),
  lookupTrackMetadata: (id: number) =>
    invoke<TrackMetadataLookupResult | null>(Channels.TracksLookupMetadata, id),
  trackArtworkDataUrl: (id: number) =>
    invoke<string | null>(Channels.TracksArtwork, id),
  updateTrack: (
    id: number,
    patch: Partial<Pick<Track, 'title' | 'artist' | 'album' | 'genre'>>
  ) => invoke<Track | null>(Channels.TracksUpdate, id, patch),
  deleteTrack: (id: number, deleteFile = false) =>
    invoke<boolean>(Channels.TracksDelete, id, deleteFile),
  markTrackPlayed: (id: number) => invoke<void>(Channels.TracksPlayed, id),
  trackStreamUrl: (id: number) => invoke<string | null>(Channels.TracksStream, id),
  editTrack: (id: number, options: TrackEditOptions) =>
    invoke<Track | null>(Channels.TracksEdit, id, options),
  renameTrackFile: (id: number, basename: string) =>
    invoke<Track | null>(Channels.TracksRename, id, basename),
  getTrack: (id: number) => invoke<Track | null>(Channels.TracksGet, id),
  downloadedYoutubeIds: (ids: string[]) =>
    invoke<string[]>(Channels.TracksDownloadedIds, ids),
  onTrackAdded: (handler: (track: Track) => void) => on<Track>(Channels.TracksAdded, handler),

  // Playlists
  listPlaylists: () => invoke<Playlist[]>(Channels.PlaylistsList),
  createPlaylist: (name: string, sourceUrl: string | null = null) =>
    invoke<Playlist>(Channels.PlaylistsCreate, name, sourceUrl),
  createSmartPlaylist: (name: string, definition: SmartPlaylistDefinition) =>
    invoke<Playlist>(Channels.PlaylistsCreateSmart, name, definition),
  updateSmartPlaylist: (id: number, name: string, definition: SmartPlaylistDefinition) =>
    invoke<Playlist | null>(Channels.PlaylistsUpdateSmart, id, name, definition),
  renamePlaylist: (id: number, name: string) =>
    invoke<Playlist | null>(Channels.PlaylistsRename, id, name),
  deletePlaylist: (id: number) => invoke<boolean>(Channels.PlaylistsDelete, id),
  addTrackToPlaylist: (playlistId: number, trackId: number) =>
    invoke<void>(Channels.PlaylistsAddTrack, playlistId, trackId),
  removeTrackFromPlaylist: (playlistId: number, trackId: number) =>
    invoke<void>(Channels.PlaylistsRemoveTrack, playlistId, trackId),
  reorderPlaylist: (playlistId: number, orderedTrackIds: number[]) =>
    invoke<void>(Channels.PlaylistsReorder, playlistId, orderedTrackIds),
  playlistsForTrack: (trackId: number) =>
    invoke<Playlist[]>(Channels.PlaylistsForTrack, trackId),
  playlistsForTracks: async (trackIds: number[]) => {
    const tuples = await invoke<Array<[number, number[]]>>(
      Channels.PlaylistsForTracks,
      trackIds
    );
    return new Map(tuples);
  },
  addTracksByYoutubeIdsToPlaylist: (playlistId: number, youtubeIdToUrl: Record<string, string>) =>
    invoke<number>(Channels.PlaylistsAddTracksByYoutubeIds, playlistId, youtubeIdToUrl),

  // Schema
  schemaHistory: () =>
    invoke<Array<{ version: number; name: string; applied_at: string }>>(Channels.SchemaHistory),

  // Tray
  sendTrayState: (state: {
    title: string | null;
    artist: string | null;
    isPlaying: boolean;
    hasPrev: boolean;
    hasNext: boolean;
  }) => ipcRenderer.send('tray:player-state', state),
  onTrayCommand: (handler: (cmd: 'toggle-play' | 'prev' | 'next') => void) =>
    on<'toggle-play' | 'prev' | 'next'>('tray:command', handler),

  // Mini player
  onMiniState: (handler: (state: {
    trackId: number | null;
    title: string | null;
    artist: string | null;
    isPlaying: boolean;
    hasPrev: boolean;
    hasNext: boolean;
    position: number;
    duration: number;
  }) => void) => on('mini:state', handler),
  sendMiniCommand: (cmd: 'toggle-play' | 'prev' | 'next' | 'expand' | 'request-state') =>
    ipcRenderer.send('mini:command', cmd),
  sendMiniState: (state: {
    trackId: number | null;
    title: string | null;
    artist: string | null;
    isPlaying: boolean;
    hasPrev: boolean;
    hasNext: boolean;
    position: number;
    duration: number;
  }) => ipcRenderer.send('mini:state-from-main', state),
  sendMiniSeek: (seconds: number) => ipcRenderer.send('mini:seek', seconds),
  onMiniSeek: (handler: (seconds: number) => void) =>
    on<number>('mini:seek-from-main', handler),

  // Sonos
  sonosDiscover: () => invoke<SonosDevice[]>(Channels.SonosDiscover),
  sonosAddByIp: (host: string) => invoke<SonosDevice>(Channels.SonosAddByIp, host),
  sonosInitFromCache: () => invoke<SonosDevice[]>(Channels.SonosInitFromCache),
  sonosPlay: (host: string, trackId: number, title?: string, artist?: string) =>
    invoke<void>(Channels.SonosPlay, host, trackId, title, artist),
  sonosPause: (host: string) => invoke<void>(Channels.SonosPause, host),
  sonosResume: (host: string) => invoke<void>(Channels.SonosResume, host),
  sonosStop: (host: string) => invoke<void>(Channels.SonosStop, host),
  sonosSetVolume: (host: string, volume: number) =>
    invoke<void>(Channels.SonosVolume, host, volume),
  sonosSeek: (host: string, seconds: number) =>
    invoke<void>(Channels.SonosSeek, host, seconds),
  sonosGetPosition: (host: string) =>
    invoke<{ position: number; duration: number }>(Channels.SonosPosition, host),

  // Mobile Sync
  getMobileSyncUrl: (trackId: number) => invoke<string>(Channels.MobileSyncGetUrl, trackId),

  // Remote Controller
  getRemoteControllerInfo: () =>
    invoke<RemoteControllerInfo>(Channels.RemoteControllerInfo),
  regenerateRemoteControllerToken: () =>
    invoke<RemoteControllerInfo>(Channels.RemoteControllerRegenerate),
  sendRemoteState: (state: RemotePlayerSnapshot) => ipcRenderer.send('remote:state-from-main', state),
  onRemoteCommand: (handler: (cmd: RemoteControllerCommand) => void) =>
    on<RemoteControllerCommand>('remote:command', handler),
  onRemoteSeek: (handler: (seconds: number) => void) =>
    on<number>('remote:seek-from-main', handler),
  onRemoteVolume: (handler: (volume: number) => void) =>
    on<number>('remote:volume-from-main', handler),

  // Window Controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => invoke<boolean>(Channels.WindowIsMaximized),
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    const handler = (_evt: unknown, val: boolean) => callback(val);
    ipcRenderer.on(Channels.WindowMaximizeChange, handler);
    return () => {
      ipcRenderer.off(Channels.WindowMaximizeChange, handler);
    };
  }
};

export type FmusicAPI = typeof api;

contextBridge.exposeInMainWorld('fmusic', api);
