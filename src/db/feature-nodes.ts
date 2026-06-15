import { openDb } from "./connection.ts";
import { newId, now } from "../shared/ids.ts";

export type NodeKind = "module" | "feature" | "task";

export type NodeStatus =
  | "planned"
  | "in_progress"
  | "ai_completed"
  | "needs_user_action"
  | "verified"
  | "broken"
  | "archived";

export type NodeSource = "ai" | "user";

export type NodePriority = "P0" | "P1" | "P2" | "P3";

export interface FeatureNode {
  id: string;
  project_id: string;
  parent_id: string | null;
  kind: NodeKind;
  depth: number;
  path: string;
  title: string;
  description: string | null;
  status: NodeStatus;
  source: NodeSource;
  phase: string;
  test_steps: string | null;
  user_action_required: string | null;
  last_tested_at: number | null;
  active_ai_run_id: string | null;
  last_client_touched: string | null;
  last_touched_at: number | null;
  client_participation: string;
  position: number;
  priority: NodePriority | null;
  estimate: string | null;
  created_at: number;
  updated_at: number;
}

export const MAX_DEPTH = 3;

export interface CreateNodeInput {
  project_id: string;
  parent_id?: string | null;
  kind: NodeKind;
  title: string;
  description?: string;
  source: NodeSource;
  phase?: string;
  status?: NodeStatus;
  position?: number;
  priority?: NodePriority;
  estimate?: string;
}

export interface ListFilters {
  status?: NodeStatus | NodeStatus[];
  kind?: NodeKind | NodeKind[];
  phase?: string;
  max_depth?: number;
  // When set together with a `phase` filter, include ancestor nodes of any
  // matching node (regardless of the ancestor's own phase). Modules are
  // cross-phase containers, so this is what tree views typically want.
  include_phase_ancestors?: boolean;
}

function pickProject(projectId: string): { active_phase: string } {
  const db = openDb();
  const row = db
    .prepare("SELECT active_phase FROM projects WHERE id = ?")
    .get(projectId) as { active_phase: string } | undefined;
  if (!row) throw new Error(`project not found: ${projectId}`);
  return row;
}

export function getNode(id: string): FeatureNode | null {
  const db = openDb();
  const row = db.prepare("SELECT * FROM feature_nodes WHERE id = ?").get(id) as
    | FeatureNode
    | undefined;
  return row ?? null;
}

export function createNode(input: CreateNodeInput): FeatureNode {
  const db = openDb();
  const id = newId();
  const ts = now();

  let parent: FeatureNode | null = null;
  if (input.parent_id) {
    parent = getNode(input.parent_id);
    if (!parent) throw new Error(`parent not found: ${input.parent_id}`);
    if (parent.project_id !== input.project_id) {
      throw new Error("parent project mismatch");
    }
    if (parent.depth + 1 > MAX_DEPTH) {
      throw new Error(`max depth ${MAX_DEPTH} exceeded`);
    }
  }

  const depth = parent ? parent.depth + 1 : 0;
  const path = parent ? `${parent.path}.${id}` : id;
  const phase =
    input.phase ?? parent?.phase ?? pickProject(input.project_id).active_phase;
  const status: NodeStatus = input.status ?? "planned";

  db.prepare(
    `INSERT INTO feature_nodes (
      id, project_id, parent_id, kind, depth, path,
      title, description, status, source, phase,
      priority, estimate,
      position, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.project_id,
    input.parent_id ?? null,
    input.kind,
    depth,
    path,
    input.title,
    input.description ?? null,
    status,
    input.source,
    phase,
    input.priority ?? null,
    input.estimate ?? null,
    input.position ?? 0,
    ts,
    ts,
  );

  return getNode(id)!;
}

export function getChildren(parentId: string): FeatureNode[] {
  const db = openDb();
  return db
    .prepare(
      `SELECT * FROM feature_nodes
       WHERE parent_id = ?
       ORDER BY position ASC, created_at ASC`,
    )
    .all(parentId) as FeatureNode[];
}

export function listSubtree(
  rootId: string,
  opts: { includeRoot?: boolean } = {},
): FeatureNode[] {
  const root = getNode(rootId);
  if (!root) return [];
  const db = openDb();
  const includeRoot = opts.includeRoot ?? true;
  const rows = db
    .prepare(
      `SELECT * FROM feature_nodes
       WHERE project_id = ?
         AND (path = ? OR path LIKE ?)
       ORDER BY path ASC`,
    )
    .all(root.project_id, root.path, `${root.path}.%`) as FeatureNode[];
  return includeRoot ? rows : rows.filter((r) => r.id !== root.id);
}

function inClause(
  field: string,
  values: readonly string[],
): { sql: string; params: string[] } {
  if (values.length === 0) return { sql: "", params: [] };
  const placeholders = values.map(() => "?").join(",");
  return { sql: `${field} IN (${placeholders})`, params: [...values] };
}

export function listProjectNodes(
  projectId: string,
  filters: ListFilters = {},
): FeatureNode[] {
  const db = openDb();

  // Special path: phase filter + ancestor inclusion. The "matching" set applies
  // all filters (status / kind / phase / max_depth); ancestors of those matches
  // come along regardless of their own phase/status/kind so the tree remains
  // visually rooted in modules.
  if (filters.phase && filters.include_phase_ancestors) {
    const matchingWhere: string[] = ["project_id = ?", "phase = ?"];
    const matchingParams: unknown[] = [projectId, filters.phase];
    if (filters.status) {
      const arr = Array.isArray(filters.status)
        ? filters.status
        : [filters.status];
      const { sql, params: p } = inClause("status", arr);
      if (sql) {
        matchingWhere.push(sql);
        matchingParams.push(...p);
      }
    }
    if (filters.kind) {
      const arr = Array.isArray(filters.kind) ? filters.kind : [filters.kind];
      const { sql, params: p } = inClause("kind", arr);
      if (sql) {
        matchingWhere.push(sql);
        matchingParams.push(...p);
      }
    }
    if (filters.max_depth !== undefined) {
      matchingWhere.push("depth <= ?");
      matchingParams.push(filters.max_depth);
    }

    const sql = `
      WITH matching AS (
        SELECT id, path FROM feature_nodes
        WHERE ${matchingWhere.join(" AND ")}
      )
      SELECT DISTINCT n.* FROM feature_nodes n
      WHERE n.project_id = ?
        AND (
          EXISTS (SELECT 1 FROM matching m WHERE m.id = n.id)
          OR EXISTS (SELECT 1 FROM matching m WHERE m.path LIKE n.path || '.%')
        )
      ORDER BY n.path ASC
    `;
    return db.prepare(sql).all(...matchingParams, projectId) as FeatureNode[];
  }

  // Default path: each filter narrows the result independently.
  const where: string[] = ["project_id = ?"];
  const params: unknown[] = [projectId];

  if (filters.status) {
    const arr = Array.isArray(filters.status)
      ? filters.status
      : [filters.status];
    const { sql, params: p } = inClause("status", arr);
    if (sql) {
      where.push(sql);
      params.push(...p);
    }
  }
  if (filters.kind) {
    const arr = Array.isArray(filters.kind) ? filters.kind : [filters.kind];
    const { sql, params: p } = inClause("kind", arr);
    if (sql) {
      where.push(sql);
      params.push(...p);
    }
  }
  if (filters.phase) {
    where.push("phase = ?");
    params.push(filters.phase);
  }
  if (filters.max_depth !== undefined) {
    where.push("depth <= ?");
    params.push(filters.max_depth);
  }

  const sql = `SELECT * FROM feature_nodes
               WHERE ${where.join(" AND ")}
               ORDER BY path ASC`;
  return db.prepare(sql).all(...params) as FeatureNode[];
}

export function deleteNode(id: string): void {
  const db = openDb();
  db.prepare("DELETE FROM feature_nodes WHERE id = ?").run(id);
}
