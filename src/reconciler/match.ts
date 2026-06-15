import { listProjectNodes, type FeatureNode } from '../db/feature-nodes.ts';
import {
  listRunsOverlappingWindow,
  parseFilesTouched,
  type AiRun,
  type RunIntent,
} from '../db/ai-runs.ts';
import {
  parsePayload,
  type ActivityEvent,
  type CommitPayload,
  type FsWatchPayload,
  type McpCallPayload,
} from '../db/events.ts';
import type { EventWindow } from './window.ts';

export type SignalStrength = 'strong' | 'medium' | 'weak';

export interface Attribution {
  feature_node_id: string;
  existing_run_id: string | null;
  signal: SignalStrength;
  intent: RunIntent;
  summary: string | null;
  client_type: string;
  files: string[];
  reason: string;
}

export const FILE_OVERLAP_THRESHOLD = 0.7;

const KNOWN_MCP_START_TOOL = 'compass_start_ai_run';

export interface MatchContext {
  project_id: string;
  nodes: FeatureNode[];
}

export function buildMatchContext(projectId: string): MatchContext {
  return {
    project_id: projectId,
    nodes: listProjectNodes(projectId),
  };
}

export function attributeWindow(
  window: EventWindow,
  ctx: MatchContext,
): Attribution | null {
  const strong = strongSignal(window);
  if (strong) return strong;

  const overlapping = listRunsOverlappingWindow({
    project_id: ctx.project_id,
    window_start: window.start,
    window_end: window.end,
  });
  const mediumActive = mediumSignalActiveRun(window, overlapping);
  if (mediumActive) return mediumActive;

  const mediumKeyword = mediumSignalCommitKeyword(window, ctx.nodes);
  if (mediumKeyword) return mediumKeyword;

  const weak = weakSignalFileOverlap(window, overlapping);
  if (weak) return weak;

  return null;
}

function collectFiles(window: EventWindow): string[] {
  const all = new Set<string>();
  for (const evt of window.events) {
    if (evt.source === 'commit') {
      for (const f of parsePayload<CommitPayload>(evt).files_changed) all.add(f);
    } else if (evt.source === 'fs_watch') {
      for (const f of parsePayload<FsWatchPayload>(evt).files) all.add(f);
    }
  }
  return Array.from(all).sort();
}

function deriveClientType(window: EventWindow, fallback = 'reconciled'): string {
  for (const evt of window.events) {
    if (evt.source === 'mcp_call') {
      const payload = parsePayload<McpCallPayload>(evt);
      if (payload.client_type) return payload.client_type;
    }
  }
  return fallback;
}

function summariseCommit(window: EventWindow): string | null {
  for (const evt of window.events) {
    if (evt.source === 'commit') {
      const payload = parsePayload<CommitPayload>(evt);
      return payload.message.split('\n')[0]?.trim() ?? null;
    }
  }
  return null;
}

function inferIntent(window: EventWindow): RunIntent {
  for (const evt of window.events) {
    if (evt.source === 'commit') {
      const msg = parsePayload<CommitPayload>(evt).message.toLowerCase();
      if (msg.includes('fix') || msg.includes('bug')) return 'fix';
      if (msg.includes('refactor')) return 'refactor';
    }
  }
  return 'implement';
}

function strongSignal(window: EventWindow): Attribution | null {
  for (const evt of window.events) {
    if (evt.source !== 'mcp_call') continue;
    const payload = parsePayload<McpCallPayload>(evt);
    if (payload.tool_name !== KNOWN_MCP_START_TOOL) continue;
    const featureNodeId = payload.args?.['feature_node_id'];
    if (typeof featureNodeId !== 'string') continue;

    return {
      feature_node_id: featureNodeId,
      existing_run_id: null,
      signal: 'strong',
      intent: (typeof payload.args['intent'] === 'string'
        ? (payload.args['intent'] as RunIntent)
        : 'implement'),
      summary: typeof payload.args['user_prompt_summary'] === 'string'
        ? (payload.args['user_prompt_summary'] as string)
        : null,
      client_type: payload.client_type ?? 'unknown',
      files: collectFiles(window),
      reason: 'mcp_call:start_ai_run in window',
    };
  }
  return null;
}

function mediumSignalActiveRun(
  window: EventWindow,
  overlapping: AiRun[],
): Attribution | null {
  if (overlapping.length === 0) return null;
  const byNode = new Map<string, AiRun>();
  for (const run of overlapping) {
    const existing = byNode.get(run.feature_node_id);
    if (!existing || run.started_at > existing.started_at) {
      byNode.set(run.feature_node_id, run);
    }
  }
  if (byNode.size !== 1) return null;
  const run = overlapping[0]!;
  return {
    feature_node_id: run.feature_node_id,
    existing_run_id: run.id,
    signal: 'medium',
    intent: run.intent,
    summary: summariseCommit(window),
    client_type: run.client_type,
    files: collectFiles(window),
    reason: `active ai_run ${run.id.slice(-6)} overlaps window`,
  };
}

function mediumSignalCommitKeyword(
  window: EventWindow,
  nodes: FeatureNode[],
): Attribution | null {
  const commit = window.events.find((e) => e.source === 'commit');
  if (!commit) return null;
  const payload = parsePayload<CommitPayload>(commit);
  const msg = payload.message.toLowerCase();

  for (const node of nodes) {
    if (node.kind === 'module') continue;
    const idPrefix = `#${node.id.slice(0, 8).toLowerCase()}`;
    if (msg.includes(idPrefix)) {
      return finalizeKeywordMatch(window, node, `id ref ${idPrefix}`);
    }
  }

  for (const node of nodes) {
    if (node.kind === 'module') continue;
    const title = node.title.trim().toLowerCase();
    if (title.length >= 4 && msg.includes(title)) {
      return finalizeKeywordMatch(window, node, `title match "${node.title}"`);
    }
  }
  return null;
}

function finalizeKeywordMatch(
  window: EventWindow,
  node: FeatureNode,
  reason: string,
): Attribution {
  return {
    feature_node_id: node.id,
    existing_run_id: null,
    signal: 'medium',
    intent: inferIntent(window),
    summary: summariseCommit(window),
    client_type: deriveClientType(window),
    files: collectFiles(window),
    reason,
  };
}

function weakSignalFileOverlap(
  window: EventWindow,
  overlapping: AiRun[],
): Attribution | null {
  const files = collectFiles(window);
  if (files.length === 0) return null;
  const fileSet = new Set(files);

  let best: { run: AiRun; ratio: number } | null = null;
  for (const run of overlapping) {
    const runFiles = parseFilesTouched(run);
    if (runFiles.length === 0) continue;
    const overlap = runFiles.filter((f) => fileSet.has(f)).length;
    const ratio = overlap / runFiles.length;
    if (ratio >= FILE_OVERLAP_THRESHOLD && (!best || ratio > best.ratio)) {
      best = { run, ratio };
    }
  }
  if (!best) return null;
  return {
    feature_node_id: best.run.feature_node_id,
    existing_run_id: best.run.id,
    signal: 'weak',
    intent: best.run.intent,
    summary: summariseCommit(window),
    client_type: best.run.client_type,
    files,
    reason: `file overlap ${(best.ratio * 100).toFixed(0)}% with run ${best.run.id.slice(-6)}`,
  };
}
