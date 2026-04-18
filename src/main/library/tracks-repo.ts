import fs from 'node:fs';
import path from 'node:path';
import NodeID3 from 'node-id3';
import { parseFile } from 'music-metadata';
import { app } from 'electron';
import type {
  Track,
  TrackMetadataSuggestions,
  TrackQuery,
  TrackSortKey
} from '../../shared/types.js';
import { getDb } from './db.js';

interface TrackRow {
  id: number;
  youtube_id: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  duration_sec: number | null;
  file_path: string;
  thumbnail_path: string | null;
  downloaded_at: string;
  play_count: number;
  last_played_at: string | null;
}

function rowToTrack(row: TrackRow): Track {
  return {
    id: row.id,
    youtubeId: row.youtube_id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    genre: row.genre,
    durationSec: row.duration_sec,
    filePath: row.file_path,
    thumbnailPath: row.thumbnail_path,
    downloadedAt: row.downloaded_at,
    playCount: row.play_count,
    lastPlayedAt: row.last_played_at
  };
}

export interface NewTrack {
  youtubeId: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  durationSec: number | null;
  filePath: string;
  thumbnailPath: string | null;
}

export function insertTrack(track: NewTrack): Track {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO tracks
       (youtube_id, title, artist, album, genre, duration_sec, file_path, thumbnail_path)
       VALUES (@youtubeId, @title, @artist, @album, @genre, @durationSec, @filePath, @thumbnailPath)`
    )
    .run(track);
  return getTrack(Number(result.lastInsertRowid))!;
}

export function getTrack(id: number): Track | null {
  const row = getDb()
    .prepare('SELECT * FROM tracks WHERE id = ?')
    .get(id) as TrackRow | undefined;
  if (!row) return null;
  const track = rowToTrack(row);
  const thumbnailPath = ensureTrackArtworkCacheSync(track) ?? track.thumbnailPath;
  return { ...track, thumbnailPath };
}

const SORT_COLUMN: Record<TrackSortKey, string> = {
  title: 'title COLLATE NOCASE',
  artist: 'artist COLLATE NOCASE',
  album: 'album COLLATE NOCASE',
  genre: 'genre COLLATE NOCASE',
  durationSec: 'duration_sec',
  downloadedAt: 'downloaded_at'
};

export function listTracks(query: TrackQuery = {}): Track[] {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.search) {
    where.push(
      '(title LIKE @q OR artist LIKE @q OR album LIKE @q OR genre LIKE @q)'
    );
    params.q = `%${query.search}%`;
  }
  if (query.genre) {
    where.push('genre = @genre');
    params.genre = query.genre;
  }

  const sortCol = SORT_COLUMN[query.sortBy ?? 'downloadedAt'];
  const sortDir = query.sortDir === 'asc' ? 'ASC' : 'DESC';
  const limit = query.limit ?? 500;
  const offset = query.offset ?? 0;

  let sql = 'SELECT t.* FROM tracks t';
  if (query.playlistId !== undefined) {
    sql += ' INNER JOIN playlist_tracks pt ON pt.track_id = t.id';
    where.push('pt.playlist_id = @playlistId');
    params.playlistId = query.playlistId;
  }
  if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
  sql +=
    query.playlistId !== undefined
      ? ' ORDER BY pt.position ASC'
      : ` ORDER BY ${sortCol} ${sortDir}`;
  sql += ' LIMIT @limit OFFSET @offset';
  params.limit = limit;
  params.offset = offset;

  const rows = db.prepare(sql).all(params) as TrackRow[];
  return rows.map((row) => {
    const track = rowToTrack(row);
    const thumbnailPath = ensureTrackArtworkCacheSync(track) ?? track.thumbnailPath;
    return { ...track, thumbnailPath };
  });
}

export function listTracksForArtworkBackfill(limit = 500): Track[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM tracks
       WHERE file_path IS NOT NULL AND TRIM(file_path) <> ''
       ORDER BY downloaded_at DESC
       LIMIT ?`
    )
    .all(limit) as TrackRow[];
  return rows.map(rowToTrack);
}

export function listGenres(): string[] {
  const rows = getDb()
    .prepare(
      "SELECT DISTINCT genre FROM tracks WHERE genre IS NOT NULL AND genre <> '' ORDER BY genre COLLATE NOCASE"
    )
    .all() as { genre: string }[];
  return rows.map((r) => r.genre);
}

function listDistinctTextValues(column: 'artist' | 'album' | 'genre'): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT ${column} AS value
       FROM tracks
       WHERE ${column} IS NOT NULL AND TRIM(${column}) <> ''
       ORDER BY ${column} COLLATE NOCASE`
    )
    .all() as Array<{ value: string }>;
  return rows.map((row) => row.value);
}

export function getTrackMetadataSuggestions(): TrackMetadataSuggestions {
  return {
    artists: listDistinctTextValues('artist'),
    albums: listDistinctTextValues('album'),
    genres: listDistinctTextValues('genre')
  };
}

function syncTrackTagsToFile(track: Track): void {
  const filePath = resolveTrackFilePath(track);
  if (!filePath || path.extname(filePath).toLowerCase() !== '.mp3') {
    return;
  }

  const result = NodeID3.update(
    {
      title: track.title,
      artist: track.artist ?? '',
      album: track.album ?? '',
      genre: track.genre ?? ''
    },
    filePath
  );

  if (result instanceof Error) {
    throw result;
  }
}

export function updateTrack(
  id: number,
  patch: Partial<Pick<Track, 'title' | 'artist' | 'album' | 'genre'>>
): Track | null {
  const current = getTrack(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  // Keep the on-disk ID3 tags in sync for MP3 files so edits made in fmusic
  // are also visible in other players and file explorers.
  syncTrackTagsToFile(next);
  getDb()
    .prepare(
      'UPDATE tracks SET title = ?, artist = ?, album = ?, genre = ? WHERE id = ?'
    )
    .run(next.title, next.artist, next.album, next.genre, id);
  return getTrack(id);
}

export function deleteTrack(id: number): boolean {
  const res = getDb().prepare('DELETE FROM tracks WHERE id = ?').run(id);
  return res.changes > 0;
}

export function incrementPlayCount(id: number): void {
  getDb()
    .prepare(
      "UPDATE tracks SET play_count = play_count + 1, last_played_at = datetime('now') WHERE id = ?"
    )
    .run(id);
}

export function findByYoutubeId(youtubeId: string): Track | null {
  const row = getDb()
    .prepare('SELECT * FROM tracks WHERE youtube_id = ?')
    .get(youtubeId) as TrackRow | undefined;
  return row ? rowToTrack(row) : null;
}

function updateFilePath(id: number, nextPath: string): void {
  getDb().prepare('UPDATE tracks SET file_path = ? WHERE id = ?').run(nextPath, id);
}

function updateThumbnailPath(id: number, nextPath: string | null): void {
  getDb().prepare('UPDATE tracks SET thumbnail_path = ? WHERE id = ?').run(nextPath, id);
}

function artworkCacheDir(): string {
  const dir = path.join(app.getPath('userData'), 'artwork-cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function artworkExtensionFromMime(mimeType: string | null | undefined): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return '.jpg';
}

function mimeTypeFromArtworkPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function ensureTrackArtworkCacheSync(track: Track): string | null {
  const cachedPath = track.thumbnailPath ? path.normalize(track.thumbnailPath) : null;
  if (cachedPath && fs.existsSync(cachedPath)) {
    return cachedPath;
  }

  const actualPath = resolveTrackFilePath(track);
  if (!actualPath || path.extname(actualPath).toLowerCase() !== '.mp3') {
    if (cachedPath) updateThumbnailPath(track.id, null);
    return null;
  }

  try {
    const tags = NodeID3.read(actualPath);
    const image =
      typeof tags.image === 'object' && tags.image && 'imageBuffer' in tags.image
        ? tags.image
        : null;
    if (!image?.imageBuffer || image.imageBuffer.length === 0) {
      if (cachedPath) updateThumbnailPath(track.id, null);
      return null;
    }

    const artworkPath = path.join(
      artworkCacheDir(),
      `track-${track.id}${artworkExtensionFromMime(image.mime)}`
    );
    fs.writeFileSync(artworkPath, image.imageBuffer);
    if (track.thumbnailPath !== artworkPath) {
      updateThumbnailPath(track.id, artworkPath);
    }
    return artworkPath;
  } catch {
    return null;
  }
}

/**
 * Attempts to locate a track file on disk when the stored path no longer
 * matches. This typically happens if the path was written with a wrong
 * encoding (e.g. the Windows console code page mangled non-ASCII bytes on an
 * older download). We scan the parent directory for a file whose name contains
 * the `[youtubeId]` marker emitted by our yt-dlp output template.
 * On success, the DB row is patched so subsequent lookups are free.
 */
export function resolveTrackFilePath(track: Track): string | null {
  const stored = track.filePath;
  const normalized = path.normalize(stored).normalize('NFC');
  if (fs.existsSync(stored)) return stored;
  if (normalized !== stored && fs.existsSync(normalized)) {
    updateFilePath(track.id, normalized);
    return normalized;
  }
  if (!track.youtubeId) return null;
  const dir = path.dirname(stored);
  if (!fs.existsSync(dir)) return null;
  const marker = `[${track.youtubeId}]`;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const match = entries.find((name) => name.normalize('NFC').includes(marker));
  if (!match) return null;
  const recovered = path.join(dir, match);
  updateFilePath(track.id, recovered);
  return recovered;
}

export interface TrackEmbeddedArtwork {
  data: Uint8Array;
  mimeType: string;
}

function pictureScore(picture: { type?: string; format?: string; description?: string }): number {
  const type = (picture.type ?? '').toLowerCase();
  const description = (picture.description ?? '').toLowerCase();
  const format = (picture.format ?? '').toLowerCase();

  let score = 0;
  if (type.includes('front')) score += 50;
  else if (type.includes('cover')) score += 35;
  else if (type.includes('media')) score += 10;

  if (description.includes('front')) score += 20;
  else if (description.includes('cover')) score += 10;

  if (format === 'image/jpeg' || format === 'image/jpg') score += 6;
  else if (format === 'image/png') score += 4;

  return score;
}

export async function getTrackEmbeddedArtwork(
  track: Track
): Promise<TrackEmbeddedArtwork | null> {
  const actualPath = resolveTrackFilePath(track);
  if (!actualPath) return null;

  try {
    const metadata = await parseFile(actualPath);
    const pictures = metadata.common.picture ?? [];
    if (pictures.length === 0) return null;
    const picture = [...pictures].sort((a, b) => pictureScore(b) - pictureScore(a))[0];
    if (!picture?.data || picture.data.length === 0) return null;
    return {
      data: picture.data,
      mimeType: picture.format || 'image/jpeg'
    };
  } catch {
    return null;
  }
}

export async function getTrackEmbeddedArtworkDataUrl(track: Track): Promise<string | null> {
  const cachedPath = track.thumbnailPath ? path.normalize(track.thumbnailPath) : null;
  if (cachedPath && fs.existsSync(cachedPath)) {
    const encoded = fs.readFileSync(cachedPath).toString('base64');
    return `data:${mimeTypeFromArtworkPath(cachedPath)};base64,${encoded}`;
  }

  const artwork = await getTrackEmbeddedArtwork(track);
  if (!artwork) {
    if (cachedPath) updateThumbnailPath(track.id, null);
    return null;
  }

  const ext =
    artwork.mimeType === 'image/png'
      ? '.png'
      : artwork.mimeType === 'image/webp'
        ? '.webp'
        : '.jpg';
  const artworkDir = path.join(app.getPath('userData'), 'artwork-cache');
  fs.mkdirSync(artworkDir, { recursive: true });
  const artworkPath = path.join(artworkDir, `track-${track.id}${ext}`);
  fs.writeFileSync(artworkPath, Buffer.from(artwork.data));
  if (track.thumbnailPath !== artworkPath) {
    updateThumbnailPath(track.id, artworkPath);
  }
  const encoded = fs.readFileSync(artworkPath).toString('base64');
  return `data:${artwork.mimeType};base64,${encoded}`;
}

export async function warmTrackArtworkCache(limit = 500): Promise<void> {
  const tracks = listTracksForArtworkBackfill(limit);
  for (const track of tracks) {
    try {
      await getTrackEmbeddedArtworkDataUrl(track);
    } catch {
      // Ignore per-track failures so one bad file does not block the rest.
    }
  }
}

/**
 * Given a batch of YouTube video ids, returns the subset that is already
 * present in the library. Used to grey out "Download" buttons in search
 * results without issuing one query per row.
 */
export function findDownloadedYoutubeIds(youtubeIds: string[]): string[] {
  if (youtubeIds.length === 0) return [];
  const placeholders = youtubeIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT youtube_id FROM tracks WHERE youtube_id IN (${placeholders})`
    )
    .all(...youtubeIds) as Array<{ youtube_id: string }>;
  return rows.map((r) => r.youtube_id);
}
