'use server';

import {
  getNode,
  getChildren,
} from '../../src/db/feature-nodes.ts';
import { listRunsByNode } from '../../src/db/ai-runs.ts';
import { listTodos } from '../../src/db/code-todos.ts';
import { renderHandoffMarkdown } from '../../src/mcp/tools/handoff-brief.ts';

export interface HandoffResult {
  ok: boolean;
  error?: string;
  markdown?: string;
}

export async function getHandoffMarkdown(
  projectId: string,
  nodeId: string,
  currentClient: string = 'dashboard',
): Promise<HandoffResult> {
  const node = getNode(nodeId);
  if (!node || node.project_id !== projectId) {
    return { ok: false, error: 'node not found' };
  }
  const parent = node.parent_id ? getNode(node.parent_id) : null;
  const children = getChildren(node.id);
  const siblings = parent
    ? getChildren(parent.id).filter((c) => c.id !== node.id)
    : [];
  const runs = listRunsByNode(node.id, 5);
  const todos = listTodos({ feature_node_id: node.id, done: false });

  const markdown = renderHandoffMarkdown({
    node,
    parent,
    siblings,
    children,
    runs,
    todos,
    currentClient,
  });
  return { ok: true, markdown };
}
