import type { ServerContext } from '../context.ts';
import type { FeatureNode } from '../../db/feature-nodes.ts';
import { getChildren } from '../../db/feature-nodes.ts';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function jsonResult(payload: unknown): ToolResult {
  const text = JSON.stringify(payload, null, 2);
  return {
    content: [{ type: 'text', text }],
    structuredContent:
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>)
        : { value: payload },
  };
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    structuredContent: { error: message },
    isError: true,
  };
}

export interface ProjectScopedTool {
  (ctx: ServerContext, args: Record<string, unknown>): Promise<ToolResult> | ToolResult;
}

export function summariseNode(node: FeatureNode, withChildren = false) {
  const base = {
    id: node.id,
    parent_id: node.parent_id,
    kind: node.kind,
    depth: node.depth,
    path: node.path,
    title: node.title,
    status: node.status,
    phase: node.phase,
    source: node.source,
    last_client_touched: node.last_client_touched,
    last_touched_at: node.last_touched_at
      ? new Date(node.last_touched_at).toISOString()
      : null,
    client_participation: safeParseJson(node.client_participation),
    last_tested_at: node.last_tested_at
      ? new Date(node.last_tested_at).toISOString()
      : null,
    active_ai_run_id: node.active_ai_run_id,
    user_action_required: node.user_action_required,
  };
  if (!withChildren) return base;
  const children = getChildren(node.id);
  const childStatusCount: Record<string, number> = {};
  for (const c of children) {
    childStatusCount[c.status] = (childStatusCount[c.status] ?? 0) + 1;
  }
  return { ...base, children_status_count: childStatusCount };
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
