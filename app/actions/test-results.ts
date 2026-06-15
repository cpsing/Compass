'use server';

import { revalidatePath } from 'next/cache';
import { getNode } from '../../src/db/feature-nodes.ts';
import { recordTestResult } from '../../src/services/test-result.ts';

export interface RecordTestActionResult {
  ok: boolean;
  error?: string;
  test_run_id?: string;
}

export async function recordTestResultAction(
  projectId: string,
  nodeId: string,
  result: 'passed' | 'failed',
  notes?: string,
): Promise<RecordTestActionResult> {
  const node = getNode(nodeId);
  if (!node) return { ok: false, error: 'node not found' };
  if (node.project_id !== projectId) {
    return { ok: false, error: 'project mismatch' };
  }
  const r = recordTestResult({
    feature_node_id: nodeId,
    result,
    notes: notes?.trim() || null,
  });
  if (r.ok) {
    revalidatePath(`/p/${projectId}`);
    revalidatePath(`/p/${projectId}/test-queue`);
    revalidatePath(`/p/${projectId}/nodes/${nodeId}`);
    revalidatePath(`/p/${projectId}/clients`);
    revalidatePath('/');
  }
  return r;
}
