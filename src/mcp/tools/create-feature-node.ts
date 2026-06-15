import { z } from 'zod';
import { createNode, getNode } from '../../db/feature-nodes.ts';
import type { ServerContext } from '../context.ts';
import { errorResult, jsonResult, summariseNode, type ToolResult } from './shared.ts';

export const inputShape = {
  parent_id: z
    .string()
    .min(1)
    .describe('Required. Must be a feature-level node (not module, not task).'),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
};

export const description = `Create a new task node under an existing feature.

IMPORTANT RULES:
- As an AI, you can ONLY create nodes of kind='task'. Modules and features must be created by the user through the dashboard — they represent the human's product blueprint.
- If you think a new module or feature is needed, ask the user first.
- The parent_id must point to a feature-level node, not a module and not another task.

Call this when you're about to implement a concrete sub-step that's worth tracking separately.`;

export function handler(
  ctx: ServerContext,
  args: Record<string, unknown>,
): ToolResult {
  const parentId = args['parent_id'] as string;
  const title = args['title'] as string;
  const description = args['description'] as string | undefined;

  const parent = getNode(parentId);
  if (!parent) return errorResult(`parent not found: ${parentId}`);
  if (parent.project_id !== ctx.project.id) {
    return errorResult('parent belongs to a different project');
  }
  if (parent.kind !== 'feature') {
    return errorResult(
      `AI-created tasks must be children of a feature node (parent kind='${parent.kind}')`,
    );
  }

  try {
    const node = createNode({
      project_id: ctx.project.id,
      parent_id: parentId,
      kind: 'task',
      title,
      description,
      source: 'ai',
    });
    return jsonResult({ node: summariseNode(node) });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
