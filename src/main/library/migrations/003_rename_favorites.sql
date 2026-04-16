-- 003_rename_favorites: rename the legacy Spanish "Favoritos" playlist to
-- "Favorites" and ensure the English built-in row exists. If a user already
-- has a "Favorites" playlist (e.g. fresh install after the i18n migration)
-- we leave it alone; otherwise we rename the legacy one so all existing
-- rows in `playlist_tracks` keep pointing at the right id.
UPDATE playlists
   SET name = 'Favorites'
 WHERE name = 'Favoritos'
   AND NOT EXISTS (SELECT 1 FROM playlists WHERE name = 'Favorites');

-- Drop any leftover legacy row (only possible if both names coexisted before
-- this migration ran, which shouldn't happen in practice but keeps the
-- schema deterministic).
DELETE FROM playlists WHERE name = 'Favoritos';

-- Make sure the English built-in row exists even on bases that never had the
-- legacy Spanish name (e.g. a base built at migration version 1).
INSERT OR IGNORE INTO playlists(name) VALUES ('Favorites');
