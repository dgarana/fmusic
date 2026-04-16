-- 004_playlist_slug: give built-in playlists a stable identifier so their
-- display name can be translated at render time without breaking existing
-- references (playlist_tracks rows, user casts, etc.).
--
-- `slug` is NULL for user-created playlists (their `name` is what gets
-- displayed) and 'favorites' for the built-in Favorites playlist.

ALTER TABLE playlists ADD COLUMN slug TEXT;

UPDATE playlists SET slug = 'favorites' WHERE name = 'Favorites';

-- Nulls are allowed (user-created playlists); only non-null slugs must be
-- unique. SQLite supports partial unique indexes since 3.8.0.
CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_slug_unique
  ON playlists(slug) WHERE slug IS NOT NULL;
