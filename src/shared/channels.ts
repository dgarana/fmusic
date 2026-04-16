// Canonical list of IPC channels used by both main and preload.
export const Channels = {
  // App / system
  OpenExternal: 'app:open-external',
  OpenPath: 'app:open-path',
  PickDirectory: 'app:pick-directory',

  // Dependencies
  DepsStatus: 'deps:status',
  DepsUpdateYtDlp: 'deps:update-yt-dlp',

  // Settings
  SettingsGet: 'settings:get',
  SettingsUpdate: 'settings:update',

  // YouTube
  YtSearch: 'yt:search',
  YtInfo: 'yt:info',
  YtStreamUrl: 'yt:stream-url',

  // Downloads
  DownloadEnqueue: 'download:enqueue',
  DownloadCancel: 'download:cancel',
  DownloadList: 'download:list',
  DownloadJobUpdate: 'download:job-update', // event, main -> renderer

  // Library - tracks
  TracksList: 'tracks:list',
  TracksGenres: 'tracks:genres',
  TracksUpdate: 'tracks:update',
  TracksDelete: 'tracks:delete',
  TracksPlayed: 'tracks:played',
  TracksAdded: 'tracks:added', // event, main -> renderer
  TracksStream: 'tracks:stream-url',

  // Library - playlists
  PlaylistsList: 'playlists:list',
  PlaylistsCreate: 'playlists:create',
  PlaylistsRename: 'playlists:rename',
  PlaylistsDelete: 'playlists:delete',
  PlaylistsAddTrack: 'playlists:add-track',
  PlaylistsRemoveTrack: 'playlists:remove-track',
  PlaylistsReorder: 'playlists:reorder',
  PlaylistsForTrack: 'playlists:for-track',
  PlaylistsForTracks: 'playlists:for-tracks',

  // Schema
  SchemaHistory: 'schema:history'
} as const;

export type ChannelName = (typeof Channels)[keyof typeof Channels];
