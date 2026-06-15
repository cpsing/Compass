import { openDb } from "./connection.ts";
import { newId, now } from "../shared/ids.ts";

export type EventSource = "commit" | "fs_watch" | "mcp_call";

export interface NewEvent {
  project_id: string;
  source: EventSource;
  event_type: string;
  payload: unknown;
  occurred_at?: number;
}

export interface ActivityEvent {
  id: string;
  project_id: string;
  source: EventSource;
  event_type: string;
  payload: string;
  ai_run_id: string | null;
  feature_node_id: string | null;
  reconciled: 0 | 1 | 2;
  reconciliation_note: string | null;
  occurred_at: number;
  ingested_at: number;
}

export function insertEvent(evt: NewEvent): string {
  const db = openDb();
  const id = newId();
  const ingestedAt = now();
  const occurredAt = evt.occurred_at ?? ingestedAt;

  db.prepare(
    `INSERT INTO activity_events
       (id, project_id, source, event_type, payload, occurred_at, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    evt.project_id,
    evt.source,
    evt.event_type,
    JSON.stringify(evt.payload),
    occurredAt,
    ingestedAt,
  );

  return id;
}

export function countEvents(projectId: string): number {
  const db = openDb();
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM activity_events WHERE project_id = ?")
    .get(projectId) as { n: number };
  return row.n;
}

export function recentEvents(
  projectId: string,
  limit = 10,
): Array<Record<string, unknown>> {
  const db = openDb();
  return db
    .prepare(
      `SELECT id, source, event_type, payload, occurred_at
       FROM activity_events
       WHERE project_id = ?
       ORDER BY occurred_at DESC
       LIMIT ?`,
    )
    .all(projectId, limit) as Array<Record<string, unknown>>;
}

export function listUnreconciled(projectId: string): ActivityEvent[] {
  const db = openDb();
  return db
    .prepare(
      `SELECT * FROM activity_events
       WHERE project_id = ? AND reconciled = 0
       ORDER BY occurred_at ASC`,
    )
    .all(projectId) as ActivityEvent[];
}

export function listUnattributed(projectId: string): ActivityEvent[] {
  const db = openDb();
  return db
    .prepare(
      `SELECT * FROM activity_events
       WHERE project_id = ? AND reconciled = 2
       ORDER BY occurred_at ASC`,
    )
    .all(projectId) as ActivityEvent[];
}

export function countUnattributed(projectId: string): number {
  const db = openDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM activity_events
       WHERE project_id = ? AND reconciled = 2`,
    )
    .get(projectId) as { n: number };
  return row.n;
}

export function getEvents(eventIds: string[]): ActivityEvent[] {
  if (eventIds.length === 0) return [];
  const db = openDb();
  const placeholders = eventIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT * FROM activity_events
       WHERE id IN (${placeholders})
       ORDER BY occurred_at ASC`,
    )
    .all(...eventIds) as ActivityEvent[];
}

export function markReconciled(
  eventId: string,
  aiRunId: string,
  featureNodeId: string,
): void {
  const db = openDb();
  const info = db
    .prepare(
      `UPDATE activity_events
       SET reconciled = 1, ai_run_id = ?, feature_node_id = ?
       WHERE id = ?`,
    )
    .run(aiRunId, featureNodeId, eventId);
  if (info.changes === 0) throw new Error(`event not found: ${eventId}`);
}

export function markUnattributed(eventId: string, note: string): void {
  const db = openDb();
  const info = db
    .prepare(
      `UPDATE activity_events
       SET reconciled = 2, reconciliation_note = ?
       WHERE id = ?`,
    )
    .run(note, eventId);
  if (info.changes === 0) throw new Error(`event not found: ${eventId}`);
}

export function parsePayload<T = unknown>(evt: ActivityEvent): T {
  return JSON.parse(evt.payload) as T;
}

export interface CommitPayload {
  sha: string;
  message: string;
  files_changed: string[];
  lines_added: number;
  lines_deleted: number;
  author: string;
  branch: string;
}

export interface FsWatchPayload {
  files: string[];
  change_types: Array<"added" | "modified" | "removed">;
  window_start: number;
  window_end: number;
}

export interface McpCallPayload {
  tool_name: string;
  args: Record<string, unknown>;
  session_id?: string;
  client_type?: string;
}
