// Types shared between main, preload and renderer.
// Keep this file free of any Node/Electron/DOM specific imports.

export type AudioFormat = 'mp3' | 'm4a' | 'opus';

export interface DownloadRequest {
  url: string;
  format?: AudioFormat;
  /** Audio bitrate in kbps. Default 192. */
  quality?: number;
  /**
   * Optional local playlist that the resulting track should be auto-added to
   * once the download completes. Used when importing a YouTube playlist.
   */
  playlistId?: number;
  /**
   * Opaque batch id used by the renderer to group jobs that belong to the
   * same bulk enqueue (typically a YouTube playlist import). Not persisted.
   */
  batchId?: string;
  /** Human-readable name for the batch (shown as the group header). */
  batchTitle?: string;
}

export interface YoutubePlaylistFetch {
  title: string | null;
  entries: SearchResult[];
}

export type DownloadStatus =
  | 'queued'
  | 'fetching-metadata'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DownloadJob {
  id: string;
  request: DownloadRequest;
  status: DownloadStatus;
  title?: string;
  thumbnail?: string;
  /** YouTube video id, resolved once yt-dlp fetches metadata. */
  youtubeId?: string;
  progress: number; // 0..1
  etaSeconds?: number;
  speedHuman?: string;
  error?: string;
  trackId?: number;
}

export interface SearchResult {
  id: string; // YouTube video id
  title: string;
  channel: string;
  durationSec: number | null;
  thumbnail: string | null;
  url: string;
}

export interface Track {
  id: number;
  youtubeId: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  durationSec: number | null;
  filePath: string;
  thumbnailPath: string | null;
  downloadedAt: string;
  playCount: number;
  lastPlayedAt: string | null;
}

export interface TrackMetadataSuggestions {
  artists: string[];
  albums: string[];
  genres: string[];
}

export interface TrackMetadataLookupResult {
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  source: string;
  confidence: number;
}

export interface TrackEditOptions {
  startSec: number;
  endSec: number | null;
  fadeInSec: number;
  fadeOutSec: number;
  volumeFactor: number;
  mode: 'overwrite' | 'export';
}

export interface Playlist {
  id: number;
  name: string;
  /**
   * Stable identifier for built-in playlists (e.g. 'favorites'). Null for
   * user-created playlists. The renderer uses this to translate the display
   * name without breaking references to the row.
   */
  slug: string | null;
  createdAt: string;
  coverPath: string | null;
  trackCount: number;
}

export interface PlaylistWithTracks extends Playlist {
  tracks: Track[];
}

export type Locale = 'en' | 'es';

export interface AppSettings {
  downloadDir: string;
  defaultFormat: AudioFormat;
  defaultQuality: number;
  concurrency: number;
  theme: 'system' | 'original' | 'light' | 'darcula';
  /** UI language. Defaults to 'en'. */
  language: Locale;
  /** Disable SSL certificate verification for yt-dlp (useful behind corporate VPNs). Default: false. */
  skipCertCheck: boolean;
  /** Sonos device hosts remembered across sessions. */
  sonosKnownHosts: string[];
  /** Enable Sonos integration (audio server + panel). Default: true. */
  sonosEnabled: boolean;
  /** Hide to tray instead of quitting when the main window is closed. Default: true. */
  closeToTray: boolean;
  /** Show mini player when clicking the tray icon (only applies when closeToTray is true). Default: true. */
  miniPlayerEnabled: boolean;
  /** Enable local HTTP server for mobile sync via QR codes. Default: false. */
  mobileSyncEnabled: boolean;
  /** Port for the mobile sync HTTP server. 0 for random available port. Default: 0. */
  mobileSyncPort: number;
}

export interface DependencyStatus {
  ytDlp: { present: boolean; path: string | null };
  ffmpeg: { present: boolean; path: string | null };
  ffprobe: { present: boolean; path: string | null };
}

export type TrackSortKey = 'title' | 'artist' | 'album' | 'genre' | 'durationSec' | 'downloadedAt';
export type SortDirection = 'asc' | 'desc';

export interface TrackQuery {
  search?: string;
  genre?: string;
  playlistId?: number;
  sortBy?: TrackSortKey;
  sortDir?: SortDirection;
  limit?: number;
  offset?: number;
}

export interface SonosDevice {
  name: string;
  host: string;
  port: number;
}

export type UpdateStatus =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string };
