import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { openDb, closeDb } from './connection.ts';
import { dbPath } from '../shared/paths.ts';

function schemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, 'schema.sql');
}

export function migrate(): void {
  const db = openDb();
  const sql = readFileSync(schemaPath(), 'utf8');
  db.exec(sql);

  // Add columns that may not exist in older databases
  const alterStatements = [
    "ALTER TABLE feature_nodes ADD COLUMN priority TEXT",
    "ALTER TABLE feature_nodes ADD COLUMN estimate TEXT",
  ];
  for (const stmt of alterStatements) {
    try {
      db.exec(stmt);
    } catch {
      // Column already exists — safe to ignore
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  migrate();
  console.log(`migrated → ${dbPath()}`);
  closeDb();
}
