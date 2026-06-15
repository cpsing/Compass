import { basename } from "node:path";
import { realpathSync } from "node:fs";
import { openDb } from "./connection.ts";
import { newId, now } from "../shared/ids.ts";

export interface Project {
  id: string;
  name: string;
  root_path: string;
  description: string | null;
  active_phase: string;
  known_phases: string;
  created_at: number;
  updated_at: number;
}

export function canonicalRoot(rootPath: string): string {
  try {
    return realpathSync(rootPath);
  } catch {
    return rootPath;
  }
}

export function findProjectByRoot(rootPath: string): Project | null {
  const canonical = canonicalRoot(rootPath);
  const db = openDb();
  const row = db
    .prepare("SELECT * FROM projects WHERE root_path = ?")
    .get(canonical) as Project | undefined;
  return row ?? null;
}

export function ensureProject(rootPath: string, name?: string): Project {
  const canonical = canonicalRoot(rootPath);
  const existing = findProjectByRoot(canonical);
  if (existing) return existing;

  const db = openDb();
  const id = newId();
  const ts = now();
  const projectName = name ?? basename(canonical);

  db.prepare(
    `INSERT INTO projects (id, name, root_path, active_phase, known_phases, created_at, updated_at)
     VALUES (?, ?, ?, 'v1', '["v1"]', ?, ?)`,
  ).run(id, projectName, canonical, ts, ts);

  return findProjectByRoot(canonical)!;
}
