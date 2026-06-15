import { z } from 'zod';
import { getNode } from '../../db/feature-nodes.ts';
import {
  setActiveAiRun,
  touchByClient,
  updateStatus,
} from '../../db/feature-node-mutations.ts';
import { createRun, getRun } from '../../db/ai-runs.ts';
import { now } from '../../shared/ids.ts';
import type { ServerContext } from '../context.ts';
import { errorResult, jsonResult, type ToolResult } from './shared.ts';

export const inputShape = {
  feature_node_id: z.string().min(1),
  intent: z.enum(['implement', 'fix', 'refactor', 'explore']),
  user_prompt_summary: z
    .string()
    .min(1)
    .max(1000)
    .describe('1-2 sentences summarizing what the user asked you to do.'),
  plan: z.string().max(8000).optional().describe('Markdown bullets of your approach.'),
  session_id: z.string().optional(),
};

export const description = `Mark the beginning of an AI work session on a feature.
Call this BEFORE making non-trivial code changes.

USE THIS WHEN:
- User asks you to build/fix/refactor a specific feature
- You're about to start writing or modifying code

This creates an audit trail so the user can later see what you tried and when.
If another AI session is already active on the same feature, this returns a conflict —
surface that to the user and ask whether to take over.`;

const ABANDON_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

export function handler(
  ctx: ServerContext,
  args: Record<string, unknown>,
): ToolResult {
  const nodeId = args['feature_node_id'] as string;
  const intent = args['intent'] as 'implement' | 'fix' | 'refactor' | 'explore';
  const promptSummary = args['user_prompt_summary'] as string;
  const plan = (args['plan'] as string | undefined) ?? null;
  const sessionId = (args['session_id'] as string | undefined) ?? ctx.session_id;

  const node = getNode(nodeId);
  if (!node) return errorResult(`node not found: ${nodeId}`);
  if (node.project_id !== ctx.project.id) {
    return errorResult('node belongs to a different project');
  }

  if (node.active_ai_run_id) {
    const existing = getRun(node.active_ai_run_id);
    if (existing && existing.run_status === 'running') {
      const age = now() - existing.started_at;
      if (age < ABANDON_THRESHOLD_MS) {
        return jsonResult({
          conflict: true,
          active_run: {
            id: existing.id,
            client_type: existing.client_type,
            intent: existing.intent,
            started_at: new Date(existing.started_at).toISOString(),
            age_minutes: Math.round(age / 60000),
            plan: existing.plan,
            summary: existing.summary,
          },
          message:
            'Another AI session is already active on this feature. Confirm with the user before taking over.',
        });
      }
    }
  }

  const run = createRun({
    feature_node_id: nodeId,
    client_type: ctx.client_type,
    session_id: sessionId,
    intent,
    run_status: 'running',
    origin: 'mcp',
    user_prompt_summary: promptSummary,
    plan,
  });

  setActiveAiRun(nodeId, run.id);
  updateStatus({ id: nodeId, status: 'in_progress', caller: 'ai' });
  touchByClient(nodeId, ctx.client_type);

  return jsonResult({
    ai_run_id: run.id,
    feature_node_id: nodeId,
    status: 'in_progress',
    started_at: new Date(run.started_at).toISOString(),
  });
}
