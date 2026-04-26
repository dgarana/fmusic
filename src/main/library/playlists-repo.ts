import type { Playlist, SmartPlaylistDefinition } from '../../shared/types.js';
import { getDb } from './db.js';
import { compileSmartPlaylistDefinition } from './smart-playlists.js';

interface PlaylistRow {
  id: number;
  name: string;
  slug: string | null;
  created_at: string;
  cover_path: string | null;
  track_count: number;
  source_url: string | null;
  kind: 'manual' | 'smart';
  smart_definition: string | null;
}

function rowToPlaylist(row: PlaylistRow): Playlist {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
    coverPath: row.cover_path,
    trackCount: row.track_count,
    sourceUrl: row.source_url,
    kind: row.kind ?? 'manual',
    smartDefinition: row.smart_definition
      ? (JSON.parse(row.smart_definition) as SmartPlaylistDefinition)
      : null
  };
}

const SELECT_WITH_COUNT = `
  SELECT p.id, p.name, p.slug, p.created_at, p.cover_path, p.source_url, p.kind, p.smart_definition,
         COUNT(pt.track_id) AS track_count
  FROM playlists p
  LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
`;

export function ensureBuiltinPlaylists(): void {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM playlists WHERE slug = ?')
    .get('favorites') as { id: number } | undefined;
  if (!existing) {
    db.prepare('INSERT INTO playlists(name, slug) VALUES (?, ?)').run('Favorites', 'favorites');
  }
}

export function listPlaylists(): Playlist[] {
  const rows = getDb()
    .prepare(`${SELECT_WITH_COUNT} GROUP BY p.id ORDER BY p.name COLLATE NOCASE ASC`)
    .all() as PlaylistRow[];
  return rows.map((row) => withComputedTrackCount(rowToPlaylist(row)));
}

export function getPlaylist(id: number): Playlist | null {
  const row = getDb()
    .prepare(`${SELECT_WITH_COUNT} WHERE p.id = ? GROUP BY p.id`)
    .get(id) as PlaylistRow | undefined;
  return row ? withComputedTrackCount(rowToPlaylist(row)) : null;
}

export function createPlaylist(name: string, sourceUrl: string | null = null): Playlist {
  const res = getDb()
    .prepare('INSERT INTO playlists(name, source_url) VALUES (?, ?)')
    .run(name, sourceUrl);
  return getPlaylist(Number(res.lastInsertRowid))!;
}

export function createSmartPlaylist(
  name: string,
  definition: SmartPlaylistDefinition
): Playlist {
  const res = getDb()
    .prepare('INSERT INTO playlists(name, kind, smart_definition) VALUES (?, ?, ?)')
    .run(name, 'smart', JSON.stringify(definition));
  return getPlaylist(Number(res.lastInsertRowid))!;
}

export function updateSmartPlaylist(
  id: number,
  name: string,
  definition: SmartPlaylistDefinition
): Playlist | null {
  const existing = getPlaylist(id);
  if (!existing || existing.kind !== 'smart') return null;
  getDb()
    .prepare('UPDATE playlists SET name = ?, smart_definition = ? WHERE id = ?')
    .run(name, JSON.stringify(definition), id);
  return getPlaylist(id);
}

export function renamePlaylist(id: number, name: string): Playlist | null {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Playlist name cannot be empty.');
  }

  const row = getDb().prepare('SELECT slug FROM playlists WHERE id = ?').get(id) as
    | { slug: string | null }
    | undefined;
  if (row?.slug) {
    throw new Error('Built-in playlists cannot be renamed.');
  }

  getDb().prepare('UPDATE playlists SET name = ? WHERE id = ?').run(trimmedName, id);
  return getPlaylist(id);
}

export function deletePlaylist(id: number): boolean {
  const db = getDb();
  const row = db.prepare('SELECT slug FROM playlists WHERE id = ?').get(id) as
    | { slug: string | null }
    | undefined;
  if (row?.slug) return false;
  const res = db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
  return res.changes > 0;
}

function nextPosition(playlistId: number): number {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM playlist_tracks WHERE playlist_id = ?')
    .get(playlistId) as { next: number };
  return row.next;
}

export function addTrackToPlaylist(playlistId: number, trackId: number): void {
  const playlist = getPlaylist(playlistId);
  if (!playlist || playlist.kind === 'smart') {
    throw new Error('Tracks cannot be manually added to a smart playlist.');
  }
  const position = nextPosition(playlistId);
  getDb()
    .prepare(
      'INSERT OR IGNORE INTO playlist_tracks(playlist_id, track_id, position) VALUES (?, ?, ?)'
    )
    .run(playlistId, trackId, position);
}

export function removeTrackFromPlaylist(playlistId: number, trackId: number): void {
  const playlist = getPlaylist(playlistId);
  if (!playlist || playlist.kind === 'smart') {
    throw new Error('Tracks cannot be manually removed from a smart playlist.');
  }
  getDb()
    .prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?')
    .run(playlistId, trackId);
}

export function reorderPlaylist(playlistId: number, orderedTrackIds: number[]): void {
  const playlist = getPlaylist(playlistId);
  if (!playlist || playlist.kind === 'smart') {
    throw new Error('Smart playlists cannot be manually reordered.');
  }
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
  const manualPlaylists = rows.map((row) => withComputedTrackCount(rowToPlaylist(row)));
  const smartPlaylists = smartPlaylistsForTracks([trackId]).get(trackId) ?? [];
  return [...manualPlaylists, ...smartPlaylists].sort((a, b) => a.name.localeCompare(b.name));
}

export function playlistsForTracks(trackIds: number[]): Map<number, number[]> {
  const result = new Map<number, number[]>();
  if (trackIds.length === 0) return result;
  const placeholders = trackIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT track_id, playlist_id FROM playlist_tracks WHERE track_id IN (${placeholders})`)
    .all(...trackIds) as Array<{ track_id: number; playlist_id: number }>;
  for (const row of rows) {
    const arr = result.get(row.track_id) ?? [];
    arr.push(row.playlist_id);
    result.set(row.track_id, arr);
  }
  const smartMatches = smartPlaylistsForTracks(trackIds);
  for (const [trackId, playlists] of smartMatches) {
    const arr = result.get(trackId) ?? [];
    for (const playlist of playlists) {
      if (!arr.includes(playlist.id)) {
        arr.push(playlist.id);
      }
    }
    result.set(trackId, arr);
  }
  return result;
}

function withComputedTrackCount(playlist: Playlist): Playlist {
  if (playlist.kind !== 'smart' || !playlist.smartDefinition) {
    return playlist;
  }
  const compiled = compileSmartPlaylistDefinition(playlist.smartDefinition);
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM tracks t WHERE ${compiled.sql}`)
    .get(compiled.params) as { count: number };
  return {
    ...playlist,
    trackCount: row.count
  };
}

function smartPlaylistsForTracks(trackIds: number[]): Map<number, Playlist[]> {
  const result = new Map<number, Playlist[]>();
  if (trackIds.length === 0) return result;

  const smartRows = getDb()
    .prepare(
      `${SELECT_WITH_COUNT}
       WHERE p.kind = 'smart'
       GROUP BY p.id
       ORDER BY p.name COLLATE NOCASE ASC`
    )
    .all() as PlaylistRow[];

  const placeholders = trackIds.map((_, index) => `@track_${index}`).join(', ');
  const baseTrackParams = Object.fromEntries(trackIds.map((id, index) => [`track_${index}`, id]));

  for (const row of smartRows) {
    const playlist = withComputedTrackCount(rowToPlaylist(row));
    if (!playlist.smartDefinition) continue;

    const compiled = compileSmartPlaylistDefinition(playlist.smartDefinition);
    const matches = getDb()
      .prepare(
        `SELECT t.id
         FROM tracks t
         WHERE t.id IN (${placeholders}) AND (${compiled.sql})`
      )
      .all({ ...baseTrackParams, ...compiled.params }) as Array<{ id: number }>;

    for (const match of matches) {
      const arr = result.get(match.id) ?? [];
      arr.push(playlist);
      result.set(match.id, arr);
    }
  }

  return result;
}
