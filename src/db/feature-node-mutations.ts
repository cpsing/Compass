import { openDb } from "./connection.ts";
import { now } from "../shared/ids.ts";
import type { NodeStatus } from "./feature-nodes.ts";

const TERMINAL_USER_ONLY: ReadonlyArray<NodeStatus> = ["verified", "archived"];

export interface UpdateStatusInput {
  id: string;
  status: NodeStatus;
  caller: "ai" | "user";
}

export class TrustBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrustBoundaryError";
  }
}

export function updateStatus(input: UpdateStatusInput): void {
  if (input.caller === "ai" && TERMINAL_USER_ONLY.includes(input.status)) {
    throw new TrustBoundaryError(
      `AI cannot set status='${input.status}' — user-only transition`,
    );
  }
  const db = openDb();
  const ts = now();
  const stmt = db.prepare(
    `UPDATE feature_nodes
     SET status = ?, updated_at = ?
     WHERE id = ?`,
  );
  const info = stmt.run(input.status, ts, input.id);
  if (info.changes === 0) throw new Error(`node not found: ${input.id}`);
}

export function setActiveAiRun(
  id: string,
  runId: string | null,
  expectedPrevious: string | null = null,
): boolean {
  const db = openDb();
  const ts = now();
  if (runId === null) {
    const info = db
      .prepare(
        `UPDATE feature_nodes
         SET active_ai_run_id = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(ts, id);
    return info.changes > 0;
  }
  const info = db
    .prepare(
      `UPDATE feature_nodes
       SET active_ai_run_id = ?, updated_at = ?
       WHERE id = ?
         AND (active_ai_run_id IS ? OR active_ai_run_id = ?)`,
    )
    .run(runId, ts, id, expectedPrevious, expectedPrevious ?? "");
  return info.changes > 0;
}

export function touchByClient(id: string, clientType: string): void {
  const db = openDb();
  const ts = now();
  const stmt = db.prepare(
    `UPDATE feature_nodes
     SET last_client_touched = ?,
         last_touched_at = ?,
         client_participation = json_set(
           client_participation,
           '$.' || ?,
           COALESCE(json_extract(client_participation, '$.' || ?), 0) + 1
         ),
         updated_at = ?
     WHERE id = ?`,
  );
  const info = stmt.run(clientType, ts, clientType, clientType, ts, id);
  if (info.changes === 0) throw new Error(`node not found: ${id}`);
}

export function setPhase(id: string, phase: string): void {
  const db = openDb();
  const ts = now();
  const info = db
    .prepare(
      `UPDATE feature_nodes
       SET phase = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(phase, ts, id);
  if (info.changes === 0) throw new Error(`node not found: ${id}`);
}

export function setPriorityEstimate(
  id: string,
  priority: string | null,
  estimate: string | null,
): void {
  const db = openDb();
  const ts = now();
  const info = db
    .prepare(
      `UPDATE feature_nodes
       SET priority = ?, estimate = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(priority, estimate, ts, id);
  if (info.changes === 0) throw new Error(`node not found: ${id}`);
}

export interface UpdateNodeInput {
  id: string;
  title?: string;
  description?: string | null;
}

export function updateNode(input: UpdateNodeInput): void {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (trimmed.length === 0) throw new Error("title cannot be empty");
    if (trimmed.length > 200) throw new Error("title too long (max 200)");
    fields.push("title = ?");
    params.push(trimmed);
  }
  if (input.description !== undefined) {
    const value =
      input.description === null ? null : input.description.trim() || null;
    fields.push("description = ?");
    params.push(value);
  }
  if (fields.length === 0) return;
  const db = openDb();
  const ts = now();
  fields.push("updated_at = ?");
  params.push(ts);
  params.push(input.id);
  const info = db
    .prepare(`UPDATE feature_nodes SET ${fields.join(", ")} WHERE id = ?`)
    .run(...params);
  if (info.changes === 0) throw new Error(`node not found: ${input.id}`);
}

export function setUserActionRequired(id: string, text: string | null): void {
  const db = openDb();
  const ts = now();
  const info = db
    .prepare(
      `UPDATE feature_nodes
       SET user_action_required = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(text, ts, id);
  if (info.changes === 0) throw new Error(`node not found: ${id}`);
}

export function setTestSteps(id: string, markdown: string | null): void {
  const db = openDb();
  const ts = now();
  const info = db
    .prepare(
      `UPDATE feature_nodes
       SET test_steps = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(markdown, ts, id);
  if (info.changes === 0) throw new Error(`node not found: ${id}`);
}

export function markTested(id: string, passedAt: number = now()): void {
  const db = openDb();
  const info = db
    .prepare(
      `UPDATE feature_nodes
       SET last_tested_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(passedAt, passedAt, id);
  if (info.changes === 0) throw new Error(`node not found: ${id}`);
}
