import { z } from 'zod';
import { getNode } from '../../db/feature-nodes.ts';
import {
  TrustBoundaryError,
  touchByClient,
  updateStatus,
} from '../../db/feature-node-mutations.ts';
import type { ServerContext } from '../context.ts';
import { errorResult, jsonResult, type ToolResult } from './shared.ts';

export const inputShape = {
  feature_node_id: z.string().min(1),
  status: z
    .enum(['in_progress', 'ai_completed', 'broken'])
    .describe('AI may only set in_progress | ai_completed | broken. verified/archived are human-only.'),
};

export const description = `Update a feature's status. You can only set in_progress, ai_completed, or broken.

The user must manually mark features as 'verified' through the dashboard — this is a deliberate safety boundary.

For most workflows you should use compass_start_ai_run / compass_finish_ai_run instead of this tool.
Use update_feature_status only for exceptional cases (e.g. you discovered while working on feature B that feature A is actually broken).`;

export function handler(
  ctx: ServerContext,
  args: Record<string, unknown>,
): ToolResult {
  const nodeId = args['feature_node_id'] as string;
  const status = args['status'] as 'in_progress' | 'ai_completed' | 'broken';

  const node = getNode(nodeId);
  if (!node) return errorResult(`node not found: ${nodeId}`);
  if (node.project_id !== ctx.project.id) {
    return errorResult('node belongs to a different project');
  }

  try {
    updateStatus({ id: nodeId, status, caller: 'ai' });
  } catch (err) {
    if (err instanceof TrustBoundaryError) return errorResult(err.message);
    throw err;
  }
  touchByClient(nodeId, ctx.client_type);

  return jsonResult({
    feature_node_id: nodeId,
    status,
  });
}
