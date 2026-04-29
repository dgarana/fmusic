-- 008_null_unknown_album: older downloads may have stored placeholder
-- album values from yt-dlp/ID3 metadata. Treat them as missing metadata so
-- online lookups such as MusicBrainz are not biased by "NA".

UPDATE tracks
   SET album = NULL
 WHERE lower(trim(album)) IN ('na', 'n/a');
