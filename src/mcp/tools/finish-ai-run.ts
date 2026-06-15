import { z } from 'zod';
import { finishRun, getRun } from '../../db/ai-runs.ts';
import {
  setActiveAiRun,
  setUserActionRequired,
  touchByClient,
  updateStatus,
} from '../../db/feature-node-mutations.ts';
import { getNode } from '../../db/feature-nodes.ts';
import { now } from '../../shared/ids.ts';
import type { NodeStatus } from '../../db/feature-nodes.ts';
import type { ServerContext } from '../context.ts';
import { errorResult, jsonResult, type ToolResult } from './shared.ts';

export const inputShape = {
  ai_run_id: z.string().min(1),
  run_status: z.enum(['completed', 'failed', 'abandoned']),
  next_status: z
    .enum(['ai_completed', 'needs_user_action'])
    .optional()
    .describe(
      "Status to push the feature into when run_status='completed'. Use 'needs_user_action' if the user must do something (set API key, run migration, configure external service) before testing.",
    ),
  user_action_required: z
    .string()
    .max(4000)
    .optional()
    .describe(
      "Required when next_status='needs_user_action'. Markdown list of what the user must do.",
    ),
  summary: z.string().min(1).max(4000),
  commit_sha: z.string().optional(),
  files_touched: z.array(z.string()).max(500).optional(),
};

export const description = `Mark an AI work session as complete, failed, or abandoned.

Use next_status='needs_user_action' when you finished coding BUT the user must do something before they can test it
(e.g. set up an API key, run a migration manually, configure an external service).
Always provide user_action_required when using this status.

Use next_status='ai_completed' (default for run_status='completed') when the user can test immediately.

You can never set status to 'verified' — that boundary belongs to the human user only.`;

export function handler(
  ctx: ServerContext,
  args: Record<string, unknown>,
): ToolResult {
  const runId = args['ai_run_id'] as string;
  const runStatus = args['run_status'] as 'completed' | 'failed' | 'abandoned';
  const nextStatus = (args['next_status'] as 'ai_completed' | 'needs_user_action' | undefined)
    ?? 'ai_completed';
  const userAction = args['user_action_required'] as string | undefined;
  const summary = args['summary'] as string;
  const commitSha = args['commit_sha'] as string | undefined;
  const filesTouched = args['files_touched'] as string[] | undefined;

  const run = getRun(runId);
  if (!run) return errorResult(`ai_run not found: ${runId}`);

  const node = getNode(run.feature_node_id);
  if (!node) return errorResult(`feature_node not found for run: ${runId}`);
  if (node.project_id !== ctx.project.id) {
    return errorResult('run belongs to a different project');
  }

  if (runStatus === 'completed' && nextStatus === 'needs_user_action') {
    if (!userAction || userAction.trim().length === 0) {
      return errorResult(
        "next_status='needs_user_action' requires non-empty user_action_required",
      );
    }
  }

  const completedAt = now();
  finishRun({
    id: runId,
    run_status: runStatus,
    summary,
    commit_sha: commitSha,
    files_touched: filesTouched,
    completed_at: completedAt,
  });

  let resolvedStatus: NodeStatus;
  if (runStatus === 'completed') {
    resolvedStatus = nextStatus;
    if (nextStatus === 'needs_user_action' && userAction) {
      setUserActionRequired(node.id, userAction);
    } else if (nextStatus === 'ai_completed') {
      setUserActionRequired(node.id, null);
    }
  } else if (runStatus === 'failed') {
    resolvedStatus = 'broken';
  } else {
    resolvedStatus = 'planned';
  }
  updateStatus({ id: node.id, status: resolvedStatus, caller: 'ai' });
  setActiveAiRun(node.id, null);
  touchByClient(node.id, ctx.client_type);

  return jsonResult({
    ai_run_id: runId,
    feature_node_id: node.id,
    feature_status: resolvedStatus,
    completed_at: new Date(completedAt).toISOString(),
  });
}
