import { z } from 'zod';
import { getNode } from '../../db/feature-nodes.ts';
import { createTodo } from '../../db/code-todos.ts';
import { getRun } from '../../db/ai-runs.ts';
import type { ServerContext } from '../context.ts';
import { errorResult, jsonResult, type ToolResult } from './shared.ts';

export const inputShape = {
  feature_node_id: z.string().min(1),
  content: z.string().min(1).max(2000),
  ai_run_id: z.string().optional(),
  file_path: z.string().max(500).optional().describe('Relative to project root.'),
  line_number: z.number().int().min(1).optional(),
};

export const description = `Record a code-level TODO you noticed but didn't complete in this session.

USE THIS WHEN:
- You wrote a placeholder/stub that needs real implementation later
- You spotted an obvious follow-up while doing the main task
- User said "we'll do X later" — capture it so it's not forgotten

Always attach to the feature node you're working on. Include file_path and line_number so the user can jump back to the spot in their editor.`;

export function handler(
  ctx: ServerContext,
  args: Record<string, unknown>,
): ToolResult {
  const nodeId = args['feature_node_id'] as string;
  const content = args['content'] as string;
  const runId = args['ai_run_id'] as string | undefined;
  const filePath = args['file_path'] as string | undefined;
  const lineNumber = args['line_number'] as number | undefined;

  const node = getNode(nodeId);
  if (!node) return errorResult(`node not found: ${nodeId}`);
  if (node.project_id !== ctx.project.id) {
    return errorResult('node belongs to a different project');
  }

  if (filePath) {
    if (filePath.startsWith('/') || filePath.includes('..')) {
      return errorResult('file_path must be relative and not contain ".."');
    }
  }

  if (runId) {
    const run = getRun(runId);
    if (!run) return errorResult(`ai_run not found: ${runId}`);
    if (run.feature_node_id !== nodeId) {
      return errorResult('ai_run does not belong to this feature_node');
    }
  }

  const todo = createTodo({
    feature_node_id: nodeId,
    content,
    ai_run_id: runId ?? null,
    file_path: filePath ?? null,
    line_number: lineNumber ?? null,
    created_by: 'ai',
  });

  return jsonResult({
    id: todo.id,
    feature_node_id: todo.feature_node_id,
    content: todo.content,
    file_path: todo.file_path,
    line_number: todo.line_number,
  });
}
