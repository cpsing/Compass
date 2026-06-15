import { z } from 'zod';
import { listTodos } from '../../db/code-todos.ts';
import type { ServerContext } from '../context.ts';
import { jsonResult, type ToolResult } from './shared.ts';

export const inputShape = {
  feature_node_id: z.string().optional().describe('Scope to a specific node.'),
  include_done: z.boolean().optional().describe('Include completed todos (default false).'),
  limit: z.number().int().min(1).max(200).optional(),
};

export const description = `List code todos in the current project.

By default only returns open (not-done) todos.
A todo is something that was noted by you (the AI) as needing follow-up while implementing — placeholders, stubs, deferred sub-tasks.

USE THIS WHEN:
- You want to remind the user of unfinished items
- You're about to start work and want to check pending todos in scope`;

export function handler(
  ctx: ServerContext,
  args: Record<string, unknown>,
): ToolResult {
  const nodeId = args['feature_node_id'] as string | undefined;
  const includeDone = (args['include_done'] as boolean | undefined) ?? false;
  const limit = (args['limit'] as number | undefined) ?? 100;

  const todos = listTodos({
    project_id: ctx.project.id,
    feature_node_id: nodeId,
    done: includeDone ? undefined : false,
    limit,
  });

  return jsonResult({
    count: todos.length,
    todos: todos.map((t) => ({
      id: t.id,
      feature_node_id: t.feature_node_id,
      ai_run_id: t.ai_run_id,
      content: t.content,
      file_path: t.file_path,
      line_number: t.line_number,
      done: t.done === 1,
      created_by: t.created_by,
      created_at: new Date(t.created_at).toISOString(),
      completed_at: t.completed_at ? new Date(t.completed_at).toISOString() : null,
    })),
  });
}
