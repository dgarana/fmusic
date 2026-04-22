-- 001_initial: baseline schema for FMusic library.

CREATE TABLE IF NOT EXISTS schema_history (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tracks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  youtube_id      TEXT UNIQUE,
  title           TEXT NOT NULL,
  artist          TEXT,
  album           TEXT,
  genre           TEXT,
  duration_sec    INTEGER,
  file_path       TEXT NOT NULL UNIQUE,
  thumbnail_path  TEXT,
  downloaded_at   TEXT NOT NULL DEFAULT (datetime('now')),
  play_count      INTEGER NOT NULL DEFAULT 0,
  last_played_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracks_title    ON tracks(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tracks_artist   ON tracks(artist COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tracks_genre    ON tracks(genre COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tracks_download ON tracks(downloaded_at);

CREATE TABLE IF NOT EXISTS playlists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  cover_path  TEXT
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id  INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id     INTEGER NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_position
  ON playlist_tracks(playlist_id, position);
