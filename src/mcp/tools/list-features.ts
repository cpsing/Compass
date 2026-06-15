import { z } from 'zod';
import { listProjectNodes } from '../../db/feature-nodes.ts';
import type { NodeStatus, NodeKind } from '../../db/feature-nodes.ts';
import type { ServerContext } from '../context.ts';
import { jsonResult, summariseNode, type ToolResult } from './shared.ts';

export const inputShape = {
  status: z
    .enum([
      'planned',
      'in_progress',
      'ai_completed',
      'needs_user_action',
      'verified',
      'broken',
      'archived',
      'all',
    ])
    .optional()
    .describe('Filter by status. "all" returns every status.'),
  kind: z
    .enum(['module', 'feature', 'task', 'all'])
    .optional()
    .describe('Filter by node kind.'),
  phase: z
    .string()
    .optional()
    .describe(
      "Filter by phase (e.g. 'v1', 'v2', 'all'). Defaults to the project's active_phase.",
    ),
  max_depth: z
    .number()
    .int()
    .min(0)
    .max(3)
    .optional()
    .describe('Limit tree depth (0=modules only).'),
};

export const description = `List features in the current project as a hierarchical tree summary.

By default returns only features in the current active phase.
Pass phase='all' to see deferred features (v2, someday, etc.).

USE THIS WHEN:
- User asks "what have we built" / "what's done" / "where are we"
- You're about to start a new feature and need to check what already exists
- You need to find the right place to add a new task

If a feature's last_client_touched differs from your current client and the user
wants to continue working on it, suggest calling compass_generate_handoff_brief
to get the context first.

Each parent node includes children_status_count so you can see aggregate state
without expanding the tree.`;

export function handler(
  ctx: ServerContext,
  args: Record<string, unknown>,
): ToolResult {
  const status = args['status'] as NodeStatus | 'all' | undefined;
  const kind = args['kind'] as NodeKind | 'all' | undefined;
  const phaseRaw = args['phase'] as string | undefined;
  const maxDepth = args['max_depth'] as number | undefined;

  const phase =
    phaseRaw === undefined
      ? ctx.project.active_phase
      : phaseRaw === 'all'
        ? undefined
        : phaseRaw;

  const nodes = listProjectNodes(ctx.project.id, {
    status: status && status !== 'all' ? status : undefined,
    kind: kind && kind !== 'all' ? kind : undefined,
    phase,
    max_depth: maxDepth,
  });

  const summary: Record<string, number> = { total: nodes.length };
  for (const n of nodes) summary[n.status] = (summary[n.status] ?? 0) + 1;

  return jsonResult({
    project: { id: ctx.project.id, name: ctx.project.name, active_phase: ctx.project.active_phase },
    filter: { status, kind, phase: phaseRaw ?? ctx.project.active_phase, max_depth: maxDepth },
    summary,
    nodes: nodes.map((n) => summariseNode(n, n.kind !== 'task')),
  });
}
