import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { dataDir, dbPath } from '../shared/paths.ts';
import { migrate } from './migrate.ts';

let cached: Database.Database | null = null;
let migrated = false;

export function openDb(): Database.Database {
  if (cached) return cached;

  mkdirSync(dataDir(), { recursive: true });

  const db = new Database(dbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  cached = db;

  if (!migrated) {
    migrated = true;
    migrate();
  }

  return db;
}

export function closeDb(): void {
  if (cached) {
    cached.close();
    cached = null;
  }
}
