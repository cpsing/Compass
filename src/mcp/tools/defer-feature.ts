import { z } from 'zod';
import { getNode, listSubtree } from '../../db/feature-nodes.ts';
import { setPhase } from '../../db/feature-node-mutations.ts';
import type { ServerContext } from '../context.ts';
import { errorResult, jsonResult, type ToolResult } from './shared.ts';

export const inputShape = {
  feature_node_id: z.string().min(1),
  target_phase: z
    .string()
    .min(1)
    .describe(
      'Must be in the project.known_phases list. Cannot equal the project active_phase.',
    ),
  reason: z.string().min(1).max(500),
};

export const description = `Defer a feature to a later phase (e.g. v1 → v2).
Use this when, during implementation, you realize something is out of scope for the current phase AND the user agrees to push it back.

RULES:
- You can only defer FROM the current active phase TO another phase.
- You CANNOT pull a feature from a later phase into the current one — that's a product priority decision only the user can make.
- You CANNOT invent new phase names. Use one of the known phases the user has created.
- Before calling this, confirm with the user. Do not silently defer.

Cascading: deferring a parent moves all its descendants to the same phase.`;

export function handler(
  ctx: ServerContext,
  args: Record<string, unknown>,
): ToolResult {
  const nodeId = args['feature_node_id'] as string;
  const targetPhase = args['target_phase'] as string;
  const reason = args['reason'] as string;

  const node = getNode(nodeId);
  if (!node) return errorResult(`node not found: ${nodeId}`);
  if (node.project_id !== ctx.project.id) {
    return errorResult('node belongs to a different project');
  }

  if (node.phase !== ctx.project.active_phase) {
    return errorResult(
      `cannot defer: node is in phase '${node.phase}' which is not the project active_phase '${ctx.project.active_phase}'. AI may only defer from the active phase.`,
    );
  }
  if (targetPhase === ctx.project.active_phase) {
    return errorResult('target_phase equals current active_phase (no-op)');
  }
  let knownPhases: string[] = [];
  try {
    const parsed = JSON.parse(ctx.project.known_phases);
    if (Array.isArray(parsed)) knownPhases = parsed.filter((p): p is string => typeof p === 'string');
  } catch {
    knownPhases = [];
  }
  if (!knownPhases.includes(targetPhase)) {
    return errorResult(
      `target_phase '${targetPhase}' is not in known_phases (${knownPhases.join(', ')}). AI cannot create new phases — ask the user to add it via the dashboard first.`,
    );
  }

  const subtree = listSubtree(nodeId);
  for (const n of subtree) setPhase(n.id, targetPhase);

  return jsonResult({
    feature_node_id: nodeId,
    from_phase: ctx.project.active_phase,
    to_phase: targetPhase,
    descendants_moved: subtree.length - 1,
    reason,
  });
}
