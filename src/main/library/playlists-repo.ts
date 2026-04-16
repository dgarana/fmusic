import type { Playlist } from '../../shared/types.js';
import { getDb } from './db.js';

interface PlaylistRow {
  id: number;
  name: string;
  created_at: string;
  cover_path: string | null;
  track_count: number;
}

function rowToPlaylist(row: PlaylistRow): Playlist {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    coverPath: row.cover_path,
    trackCount: row.track_count
  };
}

const SELECT_WITH_COUNT = `
  SELECT p.id, p.name, p.created_at, p.cover_path,
         COUNT(pt.track_id) AS track_count
  FROM playlists p
  LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
`;

export function listPlaylists(): Playlist[] {
  const rows = getDb()
    .prepare(
      `${SELECT_WITH_COUNT} GROUP BY p.id ORDER BY p.name COLLATE NOCASE ASC`
    )
    .all() as PlaylistRow[];
  return rows.map(rowToPlaylist);
}

export function getPlaylist(id: number): Playlist | null {
  const row = getDb()
    .prepare(`${SELECT_WITH_COUNT} WHERE p.id = ? GROUP BY p.id`)
    .get(id) as PlaylistRow | undefined;
  return row ? rowToPlaylist(row) : null;
}

export function createPlaylist(name: string): Playlist {
  const res = getDb().prepare('INSERT INTO playlists(name) VALUES (?)').run(name);
  return getPlaylist(Number(res.lastInsertRowid))!;
}

export function renamePlaylist(id: number, name: string): Playlist | null {
  getDb().prepare('UPDATE playlists SET name = ? WHERE id = ?').run(name, id);
  return getPlaylist(id);
}

export function deletePlaylist(id: number): boolean {
  const res = getDb().prepare('DELETE FROM playlists WHERE id = ?').run(id);
  return res.changes > 0;
}

function nextPosition(playlistId: number): number {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM playlist_tracks WHERE playlist_id = ?')
    .get(playlistId) as { next: number };
  return row.next;
}

export function addTrackToPlaylist(playlistId: number, trackId: number): void {
  const position = nextPosition(playlistId);
  getDb()
    .prepare(
      'INSERT OR IGNORE INTO playlist_tracks(playlist_id, track_id, position) VALUES (?, ?, ?)'
    )
    .run(playlistId, trackId, position);
}

export function removeTrackFromPlaylist(playlistId: number, trackId: number): void {
  getDb()
    .prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?')
    .run(playlistId, trackId);
}

export function reorderPlaylist(playlistId: number, orderedTrackIds: number[]): void {
  const db = getDb();
  const update = db.prepare(
    'UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?'
  );
  db.transaction((ids: number[]) => {
    ids.forEach((trackId, index) => update.run(index, playlistId, trackId));
  })(orderedTrackIds);
}

export function playlistsForTrack(trackId: number): Playlist[] {
  const rows = getDb()
    .prepare(
      `${SELECT_WITH_COUNT}
       INNER JOIN playlist_tracks pt2 ON pt2.playlist_id = p.id AND pt2.track_id = ?
       GROUP BY p.id ORDER BY p.name COLLATE NOCASE ASC`
    )
    .all(trackId) as PlaylistRow[];
  return rows.map(rowToPlaylist);
}

/**
 * Returns a map of `trackId -> playlistIds` for the given track ids. Used to
 * render "in playlists" badges in the library table without N+1 queries.
 */
export function playlistsForTracks(trackIds: number[]): Map<number, number[]> {
  const result = new Map<number, number[]>();
  if (trackIds.length === 0) return result;
  const placeholders = trackIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT track_id, playlist_id FROM playlist_tracks WHERE track_id IN (${placeholders})`
    )
    .all(...trackIds) as Array<{ track_id: number; playlist_id: number }>;
  for (const row of rows) {
    const arr = result.get(row.track_id) ?? [];
    arr.push(row.playlist_id);
    result.set(row.track_id, arr);
  }
  return result;
}
