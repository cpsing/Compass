import { z } from 'zod';
import { getNode } from '../../db/feature-nodes.ts';
import { listRunsByNode } from '../../db/ai-runs.ts';
import { listTodos } from '../../db/code-todos.ts';
import type { ServerContext } from '../context.ts';
import { errorResult, jsonResult, summariseNode, type ToolResult } from './shared.ts';

export const inputShape = {
  feature_node_id: z.string().min(1),
  recent_runs: z.number().int().min(1).max(20).optional(),
};

export const description = `Get detailed information about a single feature node.

Returns the node itself, the 5 most recent AIRuns (with plan/summary/files), and any open code todos.

Use when you need full context on a feature — for example before continuing work on it.`;

export function handler(
  ctx: ServerContext,
  args: Record<string, unknown>,
): ToolResult {
  const id = args['feature_node_id'] as string;
  const limit = (args['recent_runs'] as number | undefined) ?? 5;

  const node = getNode(id);
  if (!node) return errorResult(`node not found: ${id}`);
  if (node.project_id !== ctx.project.id) {
    return errorResult('node belongs to a different project');
  }

  const runs = listRunsByNode(id, limit);
  const todos = listTodos({ feature_node_id: id, done: false });

  return jsonResult({
    node: summariseNode(node, true),
    test_steps: node.test_steps,
    user_action_required: node.user_action_required,
    recent_runs: runs.map((r) => ({
      id: r.id,
      origin: r.origin,
      client_type: r.client_type,
      intent: r.intent,
      run_status: r.run_status,
      summary: r.summary,
      plan: r.plan,
      commit_sha: r.commit_sha,
      files_touched: r.files_touched ? JSON.parse(r.files_touched) : null,
      started_at: new Date(r.started_at).toISOString(),
      completed_at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    })),
    open_todos: todos.map((t) => ({
      id: t.id,
      content: t.content,
      file_path: t.file_path,
      line_number: t.line_number,
      created_by: t.created_by,
      created_at: new Date(t.created_at).toISOString(),
    })),
  });
}
