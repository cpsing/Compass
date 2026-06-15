import { openDb } from '../db/connection.ts';
import { getNode } from '../db/feature-nodes.ts';

export interface HardDeleteResult {
  ok: boolean;
  error?: string;
  deleted?: {
    nodes: number;
    ai_runs: number;
    code_todos: number;
    test_runs: number;
    activity_events_nullified: number;
  };
}

export function hardDeleteNode(
  nodeId: string,
  confirmTitle: string,
): HardDeleteResult {
  const node = getNode(nodeId);
  if (!node) return { ok: false, error: 'node not found' };
  if (confirmTitle.trim() !== node.title) {
    return {
      ok: false,
      error: `confirmation mismatch (expected "${node.title}")`,
    };
  }

  const db = openDb();
  const subtreeWhere =
    'project_id = ? AND (path = ? OR path LIKE ?)';
  const subtreeParams = [node.project_id, node.path, `${node.path}.%`] as const;

  const txn = db.transaction(() => {
    const nodes = db
      .prepare(`SELECT id FROM feature_nodes WHERE ${subtreeWhere}`)
      .all(...subtreeParams) as Array<{ id: string }>;
    const nodeIds = nodes.map((n) => n.id);
    if (nodeIds.length === 0) {
      return { nodes: 0, ai_runs: 0, code_todos: 0, test_runs: 0, activity_events_nullified: 0 };
    }
    const nodePlace = nodeIds.map(() => '?').join(',');

    const runs = db
      .prepare(`SELECT id FROM ai_runs WHERE feature_node_id IN (${nodePlace})`)
      .all(...nodeIds) as Array<{ id: string }>;
    const runIds = runs.map((r) => r.id);

    let nullified = 0;
    nullified += db
      .prepare(
        `UPDATE activity_events SET feature_node_id = NULL
         WHERE feature_node_id IN (${nodePlace})`,
      )
      .run(...nodeIds).changes;
    if (runIds.length > 0) {
      const runPlace = runIds.map(() => '?').join(',');
      nullified += db
        .prepare(
          `UPDATE activity_events SET ai_run_id = NULL
           WHERE ai_run_id IN (${runPlace})`,
        )
        .run(...runIds).changes;
      // test_runs reference ai_runs; nullify those refs too before cascade kicks in
      db.prepare(
        `UPDATE test_runs SET ai_run_id = NULL
         WHERE ai_run_id IN (${runPlace})`,
      ).run(...runIds);
      // code_todos.ai_run_id same situation
      db.prepare(
        `UPDATE code_todos SET ai_run_id = NULL
         WHERE ai_run_id IN (${runPlace})`,
      ).run(...runIds);
    }

    // Cascade kills children via parent_id ON DELETE CASCADE; also kills ai_runs,
    // code_todos, test_runs via feature_node_id ON DELETE CASCADE.
    const codeTodoCount = db
      .prepare(
        `SELECT COUNT(*) AS n FROM code_todos WHERE feature_node_id IN (${nodePlace})`,
      )
      .get(...nodeIds) as { n: number };
    const testRunCount = db
      .prepare(
        `SELECT COUNT(*) AS n FROM test_runs WHERE feature_node_id IN (${nodePlace})`,
      )
      .get(...nodeIds) as { n: number };

    db.prepare('DELETE FROM feature_nodes WHERE id = ?').run(nodeId);

    return {
      nodes: nodeIds.length,
      ai_runs: runIds.length,
      code_todos: codeTodoCount.n,
      test_runs: testRunCount.n,
      activity_events_nullified: nullified,
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
