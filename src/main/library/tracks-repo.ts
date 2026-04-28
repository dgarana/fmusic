import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import NodeID3 from 'node-id3';
import { parseFile } from 'music-metadata';
import { app } from 'electron';
import Database from 'better-sqlite3';
import type {
  Track,
  TrackEditOptions,
  TrackMetadataSuggestions,
  TrackQuery,
  TrackSortKey
} from '../../shared/types.js';
import { getDb } from './db.js';
import { ffmpegPath } from '../paths.js';
import { compileSmartPlaylistDefinition } from './smart-playlists.js';

import { getSettings } from '../settings.js';

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
  source_url: string | null;
}

/**
 * Normalizes a path to be relative to the download directory if it's inside it.
 * Otherwise returns the original absolute path.
 */
function toRelativePath(absolutePath: string): string {
  const downloadDir = getSettings().downloadDir;
  const normalizedBase = path.normalize(downloadDir).toLowerCase();
  const normalizedFile = path.normalize(absolutePath).toLowerCase();

  if (normalizedFile.startsWith(normalizedBase)) {
    const rel = path.relative(downloadDir, absolutePath);
    // Use forward slashes in the database for cross-platform compatibility
    return rel.split(path.sep).join('/');
  }
  return absolutePath;
}

/**
 * Resolves a stored path (which might be relative or absolute) to an absolute
 * path on the current machine.
 */
function toAbsolutePath(storedPath: string): string {
  if (path.isAbsolute(storedPath)) {
    return storedPath;
  }
  // path.join handles the forward slashes from the DB correctly on all platforms
  return path.join(getSettings().downloadDir, storedPath);
}

export function migrateToRelativePaths(db?: Database.Database): void {
  const targetDb = db ?? getDb();
  const tracks = targetDb.prepare('SELECT id, file_path FROM tracks').all() as Array<{
    id: number;
    file_path: string;
  }>;

  const update = targetDb.prepare('UPDATE tracks SET file_path = ? WHERE id = ?');
  targetDb.transaction(() => {
    for (const t of tracks) {
      const rel = toRelativePath(t.file_path);
      if (rel !== t.file_path) {
        update.run(rel, t.id);
      }
    }
  })();
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
    filePath: toAbsolutePath(row.file_path),
    thumbnailPath: row.thumbnail_path,
    downloadedAt: row.downloaded_at,
    playCount: row.play_count,
    lastPlayedAt: row.last_played_at,
    sourceUrl: row.source_url
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
  sourceUrl: string | null;
}

export function insertTrack(track: NewTrack): Track {
  const db = getDb();
  const relativePath = toRelativePath(track.filePath);
  const result = db
    .prepare(
      `INSERT INTO tracks
       (youtube_id, title, artist, album, genre, duration_sec, file_path, thumbnail_path, source_url)
       VALUES (@youtubeId, @title, @artist, @album, @genre, @durationSec, @filePath, @thumbnailPath, @sourceUrl)`
    )
    .run({ ...track, filePath: relativePath });
  return getTrack(Number(result.lastInsertRowid))!;
}

export interface ImportSummary {
  importedCount: number;
  skippedCount: number;
  failedCount: number;
}

export async function importLocalTracks(filePaths: string[]): Promise<ImportSummary> {
  let importedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const downloadDir = getSettings().downloadDir;

  const allFiles: string[] = [];
  const collect = (p: string) => {
    if (!fs.existsSync(p)) return;
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      fs.readdirSync(p).forEach((f) => collect(path.join(p, f)));
    } else if (stat.isFile()) {
      allFiles.push(p);
    }
  };
  filePaths.forEach(collect);

  for (const sourcePath of allFiles) {
    try {
      const ext = path.extname(sourcePath).toLowerCase();
      if (!['.mp3', '.m4a', '.opus', '.ogg', '.flac', '.wav'].includes(ext)) continue;

      // Check if this path (relative or absolute) is already in the DB
      const relative = toRelativePath(sourcePath);
      const existing = getDb()
        .prepare('SELECT id FROM tracks WHERE file_path = ?')
        .get(relative);
      if (existing) {
        skippedCount++;
        continue;
      }

      // 1. Copy to library folder if not already there
      let targetPath = sourcePath;
      if (!path.normalize(sourcePath).toLowerCase().startsWith(path.normalize(downloadDir).toLowerCase())) {
        const destPath = path.join(downloadDir, path.basename(sourcePath));
        
        // Double check if the destination path is already in the DB
        const destRelative = toRelativePath(destPath);
        const existingDest = getDb()
          .prepare('SELECT id FROM tracks WHERE file_path = ?')
          .get(destRelative);
        if (existingDest) {
          skippedCount++;
          continue;
        }

        if (fs.existsSync(destPath)) {
          // If file exists on disk but not in DB, it might be a collision or a manual copy.
          // For now, let's just use a timestamp to avoid overwriting.
          const parsed = path.parse(destPath);
          targetPath = path.join(downloadDir, `${parsed.name}-${Date.now()}${parsed.ext}`);
        } else {
          targetPath = destPath;
        }
        fs.copyFileSync(sourcePath, targetPath);
      }

      // 2. Read metadata
      const metadata = await parseFile(targetPath);
      const { common, format } = metadata;

      insertTrack({
        youtubeId: null,
        title: common.title || path.basename(sourcePath, ext),
        artist: common.artist || null,
        album: common.album || null,
        genre: common.genre?.[0] || null,
        durationSec: format.duration ? Math.round(format.duration) : null,
        filePath: targetPath,
        thumbnailPath: null,
        sourceUrl: null
      });

      importedCount++;
    } catch (err) {
      console.error(`[tracks] Failed to import ${sourcePath}:`, err);
      failedCount++;
    }
  }
  return { importedCount, skippedCount, failedCount };
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
  let playlistKind: 'manual' | 'smart' | null = null;

  let sql = 'SELECT t.* FROM tracks t';
  if (query.playlistId !== undefined) {
    const playlist = db
      .prepare('SELECT kind, smart_definition FROM playlists WHERE id = ?')
      .get(query.playlistId) as
      | { kind: 'manual' | 'smart'; smart_definition: string | null }
      | undefined;
    if (!playlist) return [];
    playlistKind = playlist.kind;
    if (playlist.kind === 'smart') {
      const definition = playlist.smart_definition
        ? JSON.parse(playlist.smart_definition)
        : null;
      if (!definition) return [];
      const compiled = compileSmartPlaylistDefinition(definition);
      where.push(compiled.sql);
      Object.assign(params, compiled.params);
    } else {
      sql += ' INNER JOIN playlist_tracks pt ON pt.track_id = t.id';
      where.push('pt.playlist_id = @playlistId');
      params.playlistId = query.playlistId;
    }
  }
  if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
  sql +=
    playlistKind === 'manual'
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

export function updateTrackSourceUrl(id: number, sourceUrl: string): void {
  getDb().prepare('UPDATE tracks SET source_url = ? WHERE id = ?').run(sourceUrl, id);
}

export function deleteTrack(id: number): boolean {
  const res = getDb().prepare('DELETE FROM tracks WHERE id = ?').run(id);
  return res.changes > 0;
}

/**
 * Rename the audio file backing a track on disk and update the stored
 * `file_path`. The new basename is taken verbatim except for path separators
 * and NUL bytes, which are stripped. The extension is preserved — renaming
 * never changes the audio format. Throws with a descriptive error if the
 * target basename is empty, the source file is missing, or the destination
 * already exists.
 */
export function renameTrackFile(id: number, rawBasename: string): Track | null {
  const track = getTrack(id);
  if (!track) return null;

  const sourcePath = resolveTrackFilePath(track);
  if (!sourcePath) {
    throw new Error('Track file not found on disk');
  }

  const sanitized = rawBasename
    .replace(/[\\/\u0000]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim();
  if (!sanitized) {
    throw new Error('The filename cannot be empty');
  }

  const dir = path.dirname(sourcePath);
  const ext = path.extname(sourcePath);
  // Drop any extension the user typed; we always reuse the source extension
  // so renaming can never change the audio format.
  const baseWithoutExt = path.basename(sanitized, path.extname(sanitized)) || sanitized;
  const targetPath = path.join(dir, `${baseWithoutExt}${ext}`);

  if (path.resolve(targetPath) === path.resolve(sourcePath)) {
    // No-op rename — caller passed the same name.
    return track;
  }
  if (fs.existsSync(targetPath)) {
    throw new Error(`A file named "${path.basename(targetPath)}" already exists`);
  }

  fs.renameSync(sourcePath, targetPath);
  updateFilePath(id, targetPath);
  return getTrack(id);
}

export async function editTrack(
  id: number,
  options: TrackEditOptions
): Promise<Track | null> {
  const track = getTrack(id);
  if (!track) return null;

  const inputPath = resolveTrackFilePath(track);
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error('Track file not found');
  }

  const { startSec, endSec, fadeInSec, fadeOutSec, volumeFactor } = options;
  const ext = path.extname(inputPath);
  const tempPath = path.join(path.dirname(inputPath), `edit-temp-${Date.now()}${ext}`);

  // Base args: Accurate seek after -i is better when applying filters
  const args = ['-y', '-i', inputPath, '-ss', startSec.toString()];
  if (endSec !== null) {
    args.push('-to', endSec.toString());
  }

  // Audio filters
  const filters: string[] = [];
  if (fadeInSec > 0) {
    filters.push(`afade=t=in:st=${startSec}:d=${fadeInSec}`);
  }
  if (fadeOutSec > 0 && endSec !== null) {
    filters.push(`afade=t=out:st=${endSec - fadeOutSec}:d=${fadeOutSec}`);
  }
  if (volumeFactor !== 1) {
    filters.push(`volume=${volumeFactor}`);
  }

  if (filters.length > 0) {
    args.push('-af', filters.join(','));
  }

  // Re-encoding: filters REQUIRE re-encoding.
  // We use libmp3lame for MP3, otherwise ffmpeg picks the default encoder.
  if (ext.toLowerCase() === '.mp3') {
    args.push('-c:a', 'libmp3lame', '-q:a', '2');
  }

  args.push(tempPath);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, { windowsHide: true });
    let stderr = '';
    proc.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });

  // Replace original with edited or create new
  if (options.mode === 'overwrite') {
    fs.renameSync(tempPath, inputPath);

    // Update duration in DB
    const metadata = await parseFile(inputPath);
    const durationSec = metadata.format.duration ? Math.round(metadata.format.duration) : null;

    getDb()
      .prepare('UPDATE tracks SET duration_sec = ? WHERE id = ?')
      .run(durationSec, id);

    return getTrack(id);
  } else {
    // Export mode: create a new file and a new track entry
    const parsed = path.parse(inputPath);
    // Ensure we don't overwrite if -edited already exists? 
    // Simple approach: timestamp or check existence
    let newDestPath = path.join(parsed.dir, `${parsed.name}-edited${parsed.ext}`);
    if (fs.existsSync(newDestPath)) {
      newDestPath = path.join(parsed.dir, `${parsed.name}-edited-${Date.now()}${parsed.ext}`);
    }

    fs.renameSync(tempPath, newDestPath);

    const metadata = await parseFile(newDestPath);
    const durationSec = metadata.format.duration ? Math.round(metadata.format.duration) : null;

    const newTrack = insertTrack({
      youtubeId: null, // disconnect from original YouTube ID
      title: `${track.title} (edited)`,
      artist: track.artist,
      album: track.album,
      genre: track.genre,
      durationSec,
      filePath: newDestPath,
      thumbnailPath: track.thumbnailPath,
      sourceUrl: null
    });

    return newTrack;
  }
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
  const relative = toRelativePath(nextPath);
  getDb().prepare('UPDATE tracks SET file_path = ? WHERE id = ?').run(relative, id);
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
  // Prefer the cached thumbnail file if present (covers YouTube downloads
  // whose artwork is stored alongside the audio rather than embedded in it).
  const cachedPath = track.thumbnailPath ? path.normalize(track.thumbnailPath) : null;
  if (cachedPath && fs.existsSync(cachedPath)) {
    try {
      return {
        data: fs.readFileSync(cachedPath),
        mimeType: mimeTypeFromArtworkPath(cachedPath)
      };
    } catch {
      // fall through and try to read embedded artwork from the audio file
    }
  }

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

export function cleanupMissingTracks(): void {
  const db = getDb();
  const tracks = db.prepare('SELECT id, file_path, youtube_id FROM tracks').all() as Array<{
    id: number;
    file_path: string;
    youtube_id: string | null;
  }>;

  const deleteStmt = db.prepare('DELETE FROM tracks WHERE id = ?');
  let removed = 0;

  db.transaction(() => {
    for (const t of tracks) {
      const absolutePath = toAbsolutePath(t.file_path);
      if (!fs.existsSync(absolutePath)) {
        // Try one last-ditch recovery if it has a youtubeId (handles some encoding/NFC edge cases)
        const recovered = resolveTrackFilePath({ id: t.id, filePath: t.file_path, youtubeId: t.youtube_id } as any);
        if (!recovered) {
          deleteStmt.run(t.id);
          removed++;
        }
      }
    }
  })();

  if (removed > 0) {
    console.log(`[tracks] Cleaned up ${removed} missing tracks from the library.`);
  }
}
