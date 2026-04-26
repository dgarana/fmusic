ALTER TABLE playlists ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE playlists ADD COLUMN smart_definition TEXT;

CREATE INDEX IF NOT EXISTS idx_playlists_kind ON playlists(kind);
