import { openDb } from '../db/connection.ts';
import { getNode } from '../db/feature-nodes.ts';
import {
  markTested,
  updateStatus,
} from '../db/feature-node-mutations.ts';
import { createTestRun } from '../db/test-runs.ts';
import { listRunsByNode } from '../db/ai-runs.ts';
import { now } from '../shared/ids.ts';

export interface RecordTestResultArgs {
  feature_node_id: string;
  result: 'passed' | 'failed';
  notes?: string | null;
}

export interface RecordTestResultResult {
  ok: boolean;
  error?: string;
  test_run_id?: string;
}

export function recordTestResult(
  args: RecordTestResultArgs,
): RecordTestResultResult {
  const node = getNode(args.feature_node_id);
  if (!node) return { ok: false, error: 'feature_node not found' };

  const db = openDb();
  const ts = now();
  const status = args.result === 'passed' ? 'verified' : 'broken';

  // Find latest run to attach to (best-effort)
  const recentRuns = listRunsByNode(args.feature_node_id, 1);
  const aiRunId = recentRuns[0]?.id ?? null;

  const txn = db.transaction(() => {
    const run = createTestRun({
      feature_node_id: args.feature_node_id,
      ai_run_id: aiRunId,
      result: args.result,
      notes: args.notes ?? null,
      tested_at: ts,
    });
    updateStatus({
      id: args.feature_node_id,
      status,
      caller: 'user',
    });
    markTested(args.feature_node_id, ts);
    return run.id;
  });

  try {
    const testRunId = txn();
    return { ok: true, test_run_id: testRunId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
