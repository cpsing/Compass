import { z } from 'zod';
import { getNode, listSubtree } from '../../db/feature-nodes.ts';
import type { ServerContext } from '../context.ts';
import { errorResult, jsonResult, summariseNode, type ToolResult } from './shared.ts';

export const inputShape = {
  node_id: z.string().min(1).describe('Root node to expand.'),
  include_completed: z
    .boolean()
    .optional()
    .describe('Include verified/archived nodes (default true).'),
};

export const description = `Fetch all nodes under a specific feature or module.

USE THIS WHEN:
- You're working inside a known module and need full detail of its sub-features/tasks
- User asks "show me everything under <module>"
- You're about to add multiple tasks to an existing feature and need to see what's there`;

export function handler(
  ctx: ServerContext,
  args: Record<string, unknown>,
): ToolResult {
  const nodeId = args['node_id'] as string;
  const includeCompleted = (args['include_completed'] as boolean | undefined) ?? true;

  const root = getNode(nodeId);
  if (!root) return errorResult(`node not found: ${nodeId}`);
  if (root.project_id !== ctx.project.id) {
    return errorResult('node belongs to a different project');
  }

  const subtree = listSubtree(nodeId);
  const filtered = includeCompleted
    ? subtree
    : subtree.filter(
        (n) => n.status !== 'verified' && n.status !== 'archived',
      );

  return jsonResult({
    root: summariseNode(root, true),
    count: filtered.length,
    nodes: filtered.map((n) => summariseNode(n, n.kind !== 'task')),
  });
}
