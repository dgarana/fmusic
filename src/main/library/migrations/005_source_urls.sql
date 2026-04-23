-- 005_source_urls: remember where a track or a playlist originally came from.
--
-- `source_url` is set to the canonical YouTube URL for tracks downloaded
-- from YouTube and to the canonical playlist URL for local playlists created
-- from a YouTube playlist import. It is NULL for tracks/playlists that have
-- no external origin (manual imports, user-created playlists, tracks derived
-- by the in-app audio editor).

ALTER TABLE tracks ADD COLUMN source_url TEXT;
ALTER TABLE playlists ADD COLUMN source_url TEXT;
