-- 009_track_bookmarks: saved cue points tied to a library track.

CREATE TABLE IF NOT EXISTS track_bookmarks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id      INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  label         TEXT,
  position_sec  REAL NOT NULL CHECK (position_sec >= 0),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_track_bookmarks_track_position
  ON track_bookmarks(track_id, position_sec);
