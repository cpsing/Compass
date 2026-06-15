import { openDb } from '../db/connection.ts';
import { now } from '../shared/ids.ts';

export interface ProjectOpResult {
  ok: boolean;
  error?: string;
  deleted?: {
    activity_events: number;
    code_todos: number;
    test_runs: number;
    ai_runs: number;
    feature_nodes: number;
  };
}

interface ProjectRow {
  id: string;
  name: string;
}

function loadProject(projectId: string): ProjectRow | null {
  const db = openDb();
  const row = db
    .prepare('SELECT id, name FROM projects WHERE id = ?')
    .get(projectId) as ProjectRow | undefined;
  return row ?? null;
}

export function renameProject(
  projectId: string,
  newName: string,
): ProjectOpResult {
  const trimmed = newName.trim();
  if (trimmed.length === 0) return { ok: false, error: 'name cannot be empty' };
  if (trimmed.length > 100) return { ok: false, error: 'name too long (max 100)' };
  const project = loadProject(projectId);
  if (!project) return { ok: false, error: 'project not found' };
  const db = openDb();
  db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(
    trimmed,
    now(),
    projectId,
  );
  return { ok: true };
}

export function deleteProject(
  projectId: string,
  confirmName: string,
): ProjectOpResult {
  const project = loadProject(projectId);
  if (!project) return { ok: false, error: 'project not found' };
  if (confirmName !== project.name) {
    return {
      ok: false,
      error: `confirmation mismatch (expected "${project.name}")`,
    };
  }

  const db = openDb();
  const txn = db.transaction(() => {
    const evDel = db
      .prepare('DELETE FROM activity_events WHERE project_id = ?')
      .run(projectId);
    const todoDel = db
      .prepare(
        `DELETE FROM code_todos
         WHERE feature_node_id IN (SELECT id FROM feature_nodes WHERE project_id = ?)`,
      )
      .run(projectId);
    const testDel = db
      .prepare(
        `DELETE FROM test_runs
         WHERE feature_node_id IN (SELECT id FROM feature_nodes WHERE project_id = ?)`,
      )
      .run(projectId);
    const runDel = db
      .prepare(
        `DELETE FROM ai_runs
         WHERE feature_node_id IN (SELECT id FROM feature_nodes WHERE project_id = ?)`,
      )
      .run(projectId);
    // feature_nodes cascade on parent_id; delete all in one shot
    const nodeDel = db
      .prepare('DELETE FROM feature_nodes WHERE project_id = ?')
      .run(projectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

    return {
      activity_events: evDel.changes,
      code_todos: todoDel.changes,
      test_runs: testDel.changes,
      ai_runs: runDel.changes,
      feature_nodes: nodeDel.changes,
    };
  });

  try {
    const deleted = txn();
    return { ok: true, deleted };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
