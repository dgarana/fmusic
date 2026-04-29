-- 010_track_bookmark_colors: user-selectable cue point colors.

ALTER TABLE track_bookmarks
  ADD COLUMN color TEXT NOT NULL DEFAULT '#f59e0b';
