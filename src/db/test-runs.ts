import { openDb } from './connection.ts';
import { newId, now } from '../shared/ids.ts';

export type TestResult = 'passed' | 'failed';

export interface TestRun {
  id: string;
  feature_node_id: string;
  ai_run_id: string | null;
  result: TestResult;
  notes: string | null;
  tested_at: number;
}

export interface CreateTestRunInput {
  feature_node_id: string;
  ai_run_id?: string | null;
  result: TestResult;
  notes?: string | null;
  tested_at?: number;
}

export function createTestRun(input: CreateTestRunInput): TestRun {
  const db = openDb();
  const id = newId();
  const testedAt = input.tested_at ?? now();
  db.prepare(
    `INSERT INTO test_runs (id, feature_node_id, ai_run_id, result, notes, tested_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.feature_node_id,
    input.ai_run_id ?? null,
    input.result,
    input.notes ?? null,
    testedAt,
  );
  return getTestRun(id)!;
}

export function getTestRun(id: string): TestRun | null {
  const db = openDb();
  const row = db
    .prepare('SELECT * FROM test_runs WHERE id = ?')
    .get(id) as TestRun | undefined;
  return row ?? null;
}

export function listTestRunsForNode(nodeId: string, limit = 20): TestRun[] {
  const db = openDb();
  return db
    .prepare(
      `SELECT * FROM test_runs
       WHERE feature_node_id = ?
       ORDER BY tested_at DESC
       LIMIT ?`,
    )
    .all(nodeId, limit) as TestRun[];
}
