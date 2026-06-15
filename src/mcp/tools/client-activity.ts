import { z } from 'zod';
import { getClientStats, getTopFeaturesByClient } from '../../db/ai-runs.ts';
import { now } from '../../shared/ids.ts';
import type { ServerContext } from '../context.ts';
import { errorResult, jsonResult, type ToolResult } from './shared.ts';

export const inputShape = {
  since: z
    .string()
    .optional()
    .describe('ISO timestamp lower bound. Default: 7 days ago.'),
  until: z
    .string()
    .optional()
    .describe('ISO timestamp upper bound. Default: now.'),
  client_type: z
    .string()
    .optional()
    .describe('Filter to one client (e.g. "cursor"). Omit for all clients.'),
  top_features_per_client: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe('How many top features to list per client (default 3, 0 to disable).'),
};

export const description = `Query which AI clients have been active on this project, with stats.

USE THIS WHEN:
- User asks "what did Cursor do this week" / "what was Claude Code's contribution"
- You want to suggest the user switch tools (e.g. "you've been using Cursor a lot, Claude Code might be better for this shell-heavy task")
- You're generating a project status report

Returns per-client aggregates: AIRun counts (completed/failed/abandoned/running),
distinct files touched, last active timestamp, and the top features that client worked on.`;

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function handler(
  ctx: ServerContext,
  args: Record<string, unknown>,
): ToolResult {
  const untilStr = args['until'] as string | undefined;
  const sinceStr = args['since'] as string | undefined;
  const clientType = args['client_type'] as string | undefined;
  const topFeaturesCount = (args['top_features_per_client'] as number | undefined) ?? 3;

  const untilMs = parseIso(untilStr) ?? now();
  const sinceMs = parseIso(sinceStr) ?? untilMs - DEFAULT_WINDOW_MS;
  if (sinceMs > untilMs) {
    return errorResult('since must be earlier than until');
  }

  const stats = getClientStats({
    project_id: ctx.project.id,
    since_ms: sinceMs,
    until_ms: untilMs,
    client_type: clientType,
  });

  const clients = stats.map((s) => {
    const top =
      topFeaturesCount > 0
        ? getTopFeaturesByClient({
            project_id: ctx.project.id,
            since_ms: sinceMs,
            until_ms: untilMs,
            client_type: s.client_type,
            limit: topFeaturesCount,
          })
        : [];
    return {
      client_type: s.client_type,
      run_count: s.run_count,
      completed: s.completed,
      failed: s.failed,
      abandoned: s.abandoned,
      running: s.running,
      files_touched_count: s.files_touched_count,
      success_rate:
        s.run_count > 0 ? Math.round((s.completed / s.run_count) * 100) / 100 : 0,
      last_active: s.last_active ? new Date(s.last_active).toISOString() : null,
      top_features: top.map((t) => ({
        feature_node_id: t.feature_node_id,
        title: t.title,
        run_count: t.run_count,
        last_active: new Date(t.last_active).toISOString(),
      })),
    };
  });

  return jsonResult({
    project: { id: ctx.project.id, name: ctx.project.name },
    period: {
      since: new Date(sinceMs).toISOString(),
      until: new Date(untilMs).toISOString(),
      days: Math.round((untilMs - sinceMs) / 86_400_000),
    },
    client_count: clients.length,
    clients,
  });
}

function parseIso(s: string | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
