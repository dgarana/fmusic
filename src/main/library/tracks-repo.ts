import fs from 'node:fs';
import path from 'node:path';
import type { Track, TrackQuery, TrackSortKey } from '../../shared/types.js';
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
  return row ? rowToTrack(row) : null;
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

export function updateTrack(
  id: number,
  patch: Partial<Pick<Track, 'title' | 'artist' | 'album' | 'genre'>>
): Track | null {
  const current = getTrack(id);
  if (!current) return null;
  const next = { ...current, ...patch };
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
