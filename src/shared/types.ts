// Types shared between main, preload and renderer.
// Keep this file free of any Node/Electron/DOM specific imports.

export type AudioFormat = 'mp3' | 'm4a' | 'opus';

export interface DownloadRequest {
  url: string;
  format?: AudioFormat;
  /** Audio bitrate in kbps. Default 192. */
  quality?: number;
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

export interface Playlist {
  id: number;
  name: string;
  createdAt: string;
  coverPath: string | null;
  trackCount: number;
}

export interface PlaylistWithTracks extends Playlist {
  tracks: Track[];
}

export interface AppSettings {
  downloadDir: string;
  defaultFormat: AudioFormat;
  defaultQuality: number;
  concurrency: number;
  theme: 'system' | 'dark' | 'light';
}

export interface DependencyStatus {
  ytDlp: { present: boolean; version: string | null; path: string | null };
  ffmpeg: { present: boolean; path: string | null };
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
