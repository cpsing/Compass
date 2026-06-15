'use server';

import { revalidatePath } from 'next/cache';
import { markTodoDone, getTodo } from '../../src/db/code-todos.ts';
import type { ActionResult } from './nodes.ts';

export async function markTodoDoneAction(
  projectId: string,
  nodeId: string,
  todoId: string,
): Promise<ActionResult> {
  try {
    const todo = getTodo(todoId);
    if (!todo) return { ok: false, error: 'todo not found' };
    if (todo.feature_node_id !== nodeId) {
      return { ok: false, error: 'todo does not belong to node' };
    }
    if (todo.done === 1) return { ok: true };
    markTodoDone(todoId);
    revalidatePath(`/p/${projectId}/nodes/${nodeId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
