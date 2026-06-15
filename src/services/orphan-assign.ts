import { getNode } from '../db/feature-nodes.ts';
import { createRun, type RunIntent } from '../db/ai-runs.ts';
import {
  getEvents,
  markReconciled,
  type ActivityEvent,
} from '../db/events.ts';

export interface AssignArgs {
  event_ids: string[];
  feature_node_id: string;
  client_type?: string;
  intent?: RunIntent;
  summary?: string;
}

export interface AssignResult {
  ok: boolean;
  error?: string;
  ai_run_id?: string;
  events_assigned?: number;
  feature_node_id?: string;
}

interface ExtractedPayload {
  files: string[];
  commit_sha: string | null;
  message: string | null;
}

function extractPayload(evt: ActivityEvent): ExtractedPayload {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(evt.payload) as Record<string, unknown>;
  } catch {
    return { files: [], commit_sha: null, message: null };
  }
  if (evt.source === 'commit') {
    const filesRaw = parsed['files_changed'];
    const files = Array.isArray(filesRaw)
      ? filesRaw.filter((f): f is string => typeof f === 'string')
      : [];
    return {
      files,
      commit_sha: typeof parsed['sha'] === 'string' ? (parsed['sha'] as string) : null,
      message:
        typeof parsed['message'] === 'string' ? (parsed['message'] as string) : null,
    };
  }
  if (evt.source === 'fs_watch') {
    const filesRaw = parsed['files'];
    const files = Array.isArray(filesRaw)
      ? filesRaw.filter((f): f is string => typeof f === 'string')
      : [];
    return { files, commit_sha: null, message: null };
  }
  return { files: [], commit_sha: null, message: null };
}

export function assignOrphansToNode(args: AssignArgs): AssignResult {
  if (args.event_ids.length === 0) {
    return { ok: false, error: 'no events selected' };
  }
  const node = getNode(args.feature_node_id);
  if (!node) return { ok: false, error: 'feature_node not found' };

  const events = getEvents(args.event_ids);
  if (events.length === 0) return { ok: false, error: 'no events match given ids' };
  if (events.length !== args.event_ids.length) {
    return { ok: false, error: 'one or more event ids not found' };
  }

  const projectId = events[0]!.project_id;
  if (node.project_id !== projectId) {
    return { ok: false, error: 'feature_node belongs to a different project' };
  }
  for (const e of events) {
    if (e.project_id !== projectId) {
      return { ok: false, error: 'events span multiple projects' };
    }
    if (e.reconciled !== 2) {
      return {
        ok: false,
        error: `event ${e.id} is not in unattributed state (reconciled=${e.reconciled})`,
      };
    }
  }

  const fileSet = new Set<string>();
  let commitSha: string | null = null;
  let firstMessage: string | null = null;
  for (const evt of events) {
    const payload = extractPayload(evt);
    for (const f of payload.files) fileSet.add(f);
    if (!commitSha && payload.commit_sha) commitSha = payload.commit_sha;
    if (!firstMessage && payload.message) firstMessage = payload.message;
  }

  const startedAt = events[0]!.occurred_at;
  const completedAt = events[events.length - 1]!.occurred_at;
  const filesTouched = fileSet.size > 0 ? Array.from(fileSet).sort() : null;
  const summary =
    args.summary ??
    firstMessage?.split('\n')[0]?.trim() ??
    `Assigned ${events.length} unattributed event(s) via dashboard`;

  const run = createRun({
    feature_node_id: args.feature_node_id,
    client_type: args.client_type ?? 'dashboard',
    intent: args.intent ?? 'implement',
    run_status: 'completed',
    origin: 'reconciled',
    summary,
    commit_sha: commitSha,
    files_touched: filesTouched,
    started_at: startedAt,
    completed_at: completedAt,
  });

  for (const evt of events) {
    markReconciled(evt.id, run.id, args.feature_node_id);
  }

  return {
    ok: true,
    ai_run_id: run.id,
    events_assigned: events.length,
    feature_node_id: args.feature_node_id,
  };
}
