import { openDb } from "./connection.ts";
import { newId, now } from "../shared/ids.ts";

export type RunIntent = "implement" | "fix" | "refactor" | "explore";
export type RunStatus = "running" | "completed" | "failed" | "abandoned";
export type RunOrigin = "mcp" | "reconciled";

export interface AiRun {
  id: string;
  feature_node_id: string;
  client_type: string;
  session_id: string | null;
  intent: RunIntent;
  run_status: RunStatus;
  origin: RunOrigin;
  user_prompt_summary: string | null;
  plan: string | null;
  summary: string | null;
  commit_sha: string | null;
  files_touched: string | null;
  started_at: number;
  completed_at: number | null;
}

export interface CreateRunInput {
  feature_node_id: string;
  client_type: string;
  session_id?: string | null;
  intent: RunIntent;
  run_status?: RunStatus;
  origin: RunOrigin;
  user_prompt_summary?: string | null;
  plan?: string | null;
  summary?: string | null;
  commit_sha?: string | null;
  files_touched?: string[] | null;
  started_at?: number;
  completed_at?: number | null;
}

export function createRun(input: CreateRunInput): AiRun {
  const db = openDb();
  const id = newId();
  const startedAt = input.started_at ?? now();
  const filesJson = input.files_touched
    ? JSON.stringify(input.files_touched)
    : null;

  db.prepare(
    `INSERT INTO ai_runs (
      id, feature_node_id, client_type, session_id, intent, run_status, origin,
      user_prompt_summary, plan, summary, commit_sha, files_touched,
      started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.feature_node_id,
    input.client_type,
    input.session_id ?? null,
    input.intent,
    input.run_status ?? "running",
    input.origin,
    input.user_prompt_summary ?? null,
    input.plan ?? null,
    input.summary ?? null,
    input.commit_sha ?? null,
    filesJson,
    startedAt,
    input.completed_at ?? null,
  );

  return getRun(id)!;
}

export function getRun(id: string): AiRun | null {
  const db = openDb();
  const row = db.prepare("SELECT * FROM ai_runs WHERE id = ?").get(id) as
    | AiRun
    | undefined;
  return row ?? null;
}

export function listRunsByNode(nodeId: string, limit = 10): AiRun[] {
  const db = openDb();
  return db
    .prepare(
      `SELECT * FROM ai_runs
       WHERE feature_node_id = ?
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(nodeId, limit) as AiRun[];
}

export interface RunOverlapQuery {
  project_id: string;
  window_start: number;
  window_end: number;
}

export function listRunsOverlappingWindow(q: RunOverlapQuery): AiRun[] {
  const db = openDb();
  return db
    .prepare(
      `SELECT ai_runs.* FROM ai_runs
       JOIN feature_nodes ON feature_nodes.id = ai_runs.feature_node_id
       WHERE feature_nodes.project_id = ?
         AND ai_runs.started_at <= ?
         AND (ai_runs.completed_at IS NULL OR ai_runs.completed_at >= ?)
       ORDER BY ai_runs.started_at DESC`,
    )
    .all(q.project_id, q.window_end, q.window_start) as AiRun[];
}

export function listRecentRunsForProject(
  projectId: string,
  sinceMs: number,
  limit = 50,
): AiRun[] {
  const db = openDb();
  return db
    .prepare(
      `SELECT ai_runs.* FROM ai_runs
       JOIN feature_nodes ON feature_nodes.id = ai_runs.feature_node_id
       WHERE feature_nodes.project_id = ?
         AND ai_runs.started_at >= ?
       ORDER BY ai_runs.started_at DESC
       LIMIT ?`,
    )
    .all(projectId, sinceMs, limit) as AiRun[];
}

export interface FinishRunInput {
  id: string;
  run_status: "completed" | "failed" | "abandoned";
  summary?: string | null;
  commit_sha?: string | null;
  files_touched?: string[] | null;
  completed_at?: number;
}

export function finishRun(input: FinishRunInput): void {
  const db = openDb();
  const completedAt = input.completed_at ?? now();
  const filesJson =
    input.files_touched !== undefined
      ? input.files_touched
        ? JSON.stringify(input.files_touched)
        : null
      : undefined;

  if (filesJson === undefined) {
    db.prepare(
      `UPDATE ai_runs
       SET run_status = ?, summary = COALESCE(?, summary),
           commit_sha = COALESCE(?, commit_sha),
           completed_at = ?
       WHERE id = ?`,
    ).run(
      input.run_status,
      input.summary ?? null,
      input.commit_sha ?? null,
      completedAt,
      input.id,
    );
  } else {
    db.prepare(
      `UPDATE ai_runs
       SET run_status = ?, summary = COALESCE(?, summary),
           commit_sha = COALESCE(?, commit_sha),
           files_touched = ?,
           completed_at = ?
       WHERE id = ?`,
    ).run(
      input.run_status,
      input.summary ?? null,
      input.commit_sha ?? null,
      filesJson,
      completedAt,
      input.id,
    );
  }
}

export function parseFilesTouched(run: AiRun): string[] {
  if (!run.files_touched) return [];
  try {
    const parsed = JSON.parse(run.files_touched);
    return Array.isArray(parsed)
      ? parsed.filter((f): f is string => typeof f === "string")
      : [];
  } catch {
    return [];
  }
}

export interface ClientStats {
  client_type: string;
  run_count: number;
  completed: number;
  failed: number;
  abandoned: number;
  running: number;
  files_touched_count: number;
  last_active: number | null;
}

export interface ClientStatsQuery {
  project_id: string;
  since_ms: number;
  until_ms: number;
  client_type?: string;
}

export function getClientStats(q: ClientStatsQuery): ClientStats[] {
  const db = openDb();
  const params: unknown[] = [q.project_id, q.since_ms, q.until_ms];
  let clientWhere = "";
  if (q.client_type) {
    clientWhere = "AND ai_runs.client_type = ?";
    params.push(q.client_type);
  }
  const rows = db
    .prepare(
      `SELECT
        ai_runs.client_type AS client_type,
        COUNT(*) AS run_count,
        SUM(CASE WHEN ai_runs.run_status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN ai_runs.run_status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN ai_runs.run_status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
        SUM(CASE WHEN ai_runs.run_status = 'running' THEN 1 ELSE 0 END) AS running,
        MAX(ai_runs.started_at) AS last_active,
        COUNT(DISTINCT CASE WHEN ai_runs.files_touched IS NOT NULL THEN ai_runs.id END) AS runs_with_files
       FROM ai_runs
       JOIN feature_nodes ON feature_nodes.id = ai_runs.feature_node_id
       WHERE feature_nodes.project_id = ?
         AND ai_runs.started_at >= ?
         AND ai_runs.started_at <= ?
         ${clientWhere}
       GROUP BY ai_runs.client_type
       ORDER BY run_count DESC`,
    )
    .all(...params) as Array<Omit<ClientStats, "files_touched_count"> & { runs_with_files: number }>;

  return rows.map((r) => ({
    ...r,
    files_touched_count: r.runs_with_files > 0 ? countDistinctFiles(q, r.client_type) : 0,
  }));
}

export interface TopFeatureWithClient extends TopFeature {
  client_type: string;
}

export function getTopFeaturesByClientBatch(
  q: ClientStatsQuery,
  limitPerClient = 3,
): Map<string, TopFeature[]> {
  const db = openDb();
  const rows = db
    .prepare(
      `SELECT
         feature_nodes.id AS feature_node_id,
         feature_nodes.title AS title,
         COUNT(ai_runs.id) AS run_count,
         MAX(ai_runs.started_at) AS last_active,
         ai_runs.client_type AS client_type,
         ROW_NUMBER() OVER (PARTITION BY ai_runs.client_type ORDER BY COUNT(ai_runs.id) DESC, MAX(ai_runs.started_at) DESC) AS rn
        FROM ai_runs
        JOIN feature_nodes ON feature_nodes.id = ai_runs.feature_node_id
        WHERE feature_nodes.project_id = ?
          AND ai_runs.started_at >= ?
          AND ai_runs.started_at <= ?
        GROUP BY ai_runs.client_type, feature_nodes.id
        ORDER BY ai_runs.client_type, rn
      `,
    )
    .all(q.project_id, q.since_ms, q.until_ms) as Array<{
      feature_node_id: string;
      title: string;
      run_count: number;
      last_active: number;
      client_type: string;
      rn: number;
    }>;

  const result = new Map<string, TopFeature[]>();
  for (const row of rows) {
    if (row.rn > limitPerClient) continue;
    if (!result.has(row.client_type)) {
      result.set(row.client_type, []);
    }
    result.get(row.client_type)!.push({
      feature_node_id: row.feature_node_id,
      title: row.title,
      run_count: row.run_count,
      last_active: row.last_active,
    });
  }
  return result;
}

function countDistinctFiles(q: ClientStatsQuery, clientType: string): number {
  const db = openDb();
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT je.value) AS n
       FROM ai_runs
       JOIN feature_nodes ON feature_nodes.id = ai_runs.feature_node_id
       JOIN json_each(ai_runs.files_touched) je
       WHERE feature_nodes.project_id = ?
         AND ai_runs.started_at >= ?
         AND ai_runs.started_at <= ?
         AND ai_runs.client_type = ?
         AND ai_runs.files_touched IS NOT NULL`,
    )
    .get(q.project_id, q.since_ms, q.until_ms, clientType) as { n: number };
  return row.n;
}

export interface TopFeature {
  feature_node_id: string;
  title: string;
  run_count: number;
  last_active: number;
}

export function getTopFeaturesByClient(
  q: ClientStatsQuery & { client_type: string; limit?: number },
): TopFeature[] {
  const db = openDb();
  return db
    .prepare(
      `SELECT
        feature_nodes.id AS feature_node_id,
        feature_nodes.title AS title,
        COUNT(ai_runs.id) AS run_count,
        MAX(ai_runs.started_at) AS last_active
       FROM ai_runs
       JOIN feature_nodes ON feature_nodes.id = ai_runs.feature_node_id
       WHERE feature_nodes.project_id = ?
         AND ai_runs.started_at >= ?
         AND ai_runs.started_at <= ?
         AND ai_runs.client_type = ?
       GROUP BY feature_nodes.id
       ORDER BY run_count DESC, last_active DESC
       LIMIT ?`,
    )
    .all(
      q.project_id,
      q.since_ms,
      q.until_ms,
      q.client_type,
      q.limit ?? 3,
    ) as TopFeature[];
}
