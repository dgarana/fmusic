// Static list of migrations. To add a new migration:
//   1. Drop a `NNN_name.sql` file next to this index.
//   2. Import it with `?raw` and push it to the array below.
//
// The runner in db.ts applies them in ascending version order and records each
// applied one in `schema_history`, updating PRAGMA user_version.

import m001 from './001_initial.sql?raw';
import m002 from './002_favorites.sql?raw';
import m003 from './003_rename_favorites.sql?raw';
import m004 from './004_playlist_slug.sql?raw';

export interface MigrationDefinition {
  version: number;
  name: string;
  sql: string;
}

export const migrations: MigrationDefinition[] = [
  { version: 1, name: '001_initial', sql: m001 },
  { version: 2, name: '002_favorites', sql: m002 },
  { version: 3, name: '003_rename_favorites', sql: m003 },
  { version: 4, name: '004_playlist_slug', sql: m004 }
];
