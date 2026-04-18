// Canonical list of IPC channels used by both main and preload.
export const Channels = {
  // App / system
  AppVersion: 'app:version',
  OpenExternal: 'app:open-external',
  OpenPath: 'app:open-path',
  PickDirectory: 'app:pick-directory',

  // Dependencies
  DepsStatus: 'deps:status',
  DepsVersion: 'deps:version',
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
  TracksMetadataSuggestions: 'tracks:metadata-suggestions',
  TracksLookupMetadata: 'tracks:lookup-metadata',
  TracksUpdate: 'tracks:update',
  TracksDelete: 'tracks:delete',
  TracksPlayed: 'tracks:played',
  TracksAdded: 'tracks:added', // event, main -> renderer
  TracksStream: 'tracks:stream-url',
  TracksDownloadedIds: 'tracks:downloaded-ids',

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
  SchemaHistory: 'schema:history',

  // Updater
  UpdaterStatus: 'updater:status', // event, main -> renderer
  UpdaterCheck: 'updater:check',
  UpdaterGetStatus: 'updater:get-status',
  UpdaterDownload: 'updater:download',
  UpdaterInstall: 'updater:install',

  // Sonos
  SonosDiscover: 'sonos:discover',
  SonosAddByIp: 'sonos:add-by-ip',
  SonosInitFromCache: 'sonos:init-from-cache',
  SonosPlay: 'sonos:play',
  SonosPause: 'sonos:pause',
  SonosResume: 'sonos:resume',
  SonosStop: 'sonos:stop',
  SonosVolume: 'sonos:volume',
  SonosSeek: 'sonos:seek',
  SonosPosition: 'sonos:position'
} as const;

export type ChannelName = (typeof Channels)[keyof typeof Channels];
