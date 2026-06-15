import { z } from 'zod';
import { getNode } from '../../db/feature-nodes.ts';
import { setTestSteps } from '../../db/feature-node-mutations.ts';
import type { ServerContext } from '../context.ts';
import { errorResult, jsonResult, type ToolResult } from './shared.ts';

export const inputShape = {
  feature_node_id: z.string().min(1),
  test_steps: z
    .string()
    .min(1)
    .max(8000)
    .describe('Markdown bullets describing manual test steps for this feature.'),
};

export const description = `Write or replace the manual test steps for a feature.

Call this after finishing implementation, so the user knows exactly what to click/run to verify the feature works.
The user reads these steps in the dashboard and clicks "Passed" or "Failed".

Good test steps are concrete:
- "Open /login, type a real email, click Submit, expect redirect to /dashboard"
NOT:
- "Test the login feature"`;

export function handler(
  ctx: ServerContext,
  args: Record<string, unknown>,
): ToolResult {
  const nodeId = args['feature_node_id'] as string;
  const steps = args['test_steps'] as string;

  const node = getNode(nodeId);
  if (!node) return errorResult(`node not found: ${nodeId}`);
  if (node.project_id !== ctx.project.id) {
    return errorResult('node belongs to a different project');
  }

  setTestSteps(nodeId, steps);
  return jsonResult({
    feature_node_id: nodeId,
    test_steps_length: steps.length,
  });
}
