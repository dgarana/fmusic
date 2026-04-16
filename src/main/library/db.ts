import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { backupsDir, libraryDbPath } from '../paths.js';
import { migrations } from './migrations/index.js';

let dbInstance: Database.Database | null = null;

function backupDatabase(dbPath: string): string | null {
  if (!fs.existsSync(dbPath)) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupsDir(), `library-${timestamp}.sqlite`);
  fs.copyFileSync(dbPath, dest);
  return dest;
}

function runMigrations(db: Database.Database): void {
  const pool = [...migrations].sort((a, b) => a.version - b.version);
  if (pool.length === 0) return;

  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  const pending = pool.filter((m) => m.version > currentVersion);
  if (pending.length === 0) return;

  if (currentVersion > 0) {
    const backup = backupDatabase(libraryDbPath());
    if (backup) {
      console.log(`[db] Backed up existing library to ${backup}`);
    }
  }

  for (const migration of pending) {
    console.log(`[db] Applying migration ${migration.name}`);
    const runMigration = db.transaction(() => {
      db.exec(migration.sql);
      // schema_history is created by migration 001 itself, so insert-if-exists.
      const hasHistory = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_history'"
        )
        .get();
      if (hasHistory) {
        db.prepare(
          'INSERT OR REPLACE INTO schema_history(version, name) VALUES (?, ?)'
        ).run(migration.version, migration.name);
      }
      db.pragma(`user_version = ${migration.version}`);
    });
    runMigration();
  }
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const dbPath = libraryDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  dbInstance = db;
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export interface SchemaHistoryEntry {
  version: number;
  name: string;
  applied_at: string;
}

export function getSchemaHistory(): SchemaHistoryEntry[] {
  const db = getDb();
  return db
    .prepare('SELECT version, name, applied_at FROM schema_history ORDER BY version ASC')
    .all() as SchemaHistoryEntry[];
}
