import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../src/db/migrate.ts';
import { ensureProject } from '../src/db/projects.ts';
import { createNode } from '../src/db/feature-nodes.ts';
import { createRun, getRun, listRunsByNode } from '../src/db/ai-runs.ts';
import { insertEvent } from '../src/db/events.ts';
import { reconcile } from '../src/reconciler/index.ts';
import { openDb, closeDb } from '../src/db/connection.ts';

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: CheckResult[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  console.log(`  [${ok ? 'OK' : 'FAIL'}] ${name}${detail ? '  — ' + detail : ''}`);
}

function eventRow(eventId: string): Record<string, unknown> {
  const db = openDb();
  return db
    .prepare('SELECT * FROM activity_events WHERE id = ?')
    .get(eventId) as Record<string, unknown>;
}

function scenarioStrong(projectId: string): void {
  console.log('\n── Scenario A: strong signal (MCP start_ai_run)');
  const module = createNode({
    project_id: projectId,
    kind: 'module',
    title: 'Auth-A',
    source: 'user',
  });
  const feature = createNode({
    project_id: projectId,
    parent_id: module.id,
    kind: 'feature',
    title: 'Email login A',
    source: 'user',
  });

  const t0 = Date.now();
  const mcpId = insertEvent({
    project_id: projectId,
    source: 'mcp_call',
    event_type: 'tool_call',
    payload: {
      tool_name: 'compass_start_ai_run',
      args: {
        feature_node_id: feature.id,
        intent: 'implement',
        user_prompt_summary: 'build email login',
      },
      client_type: 'cursor',
    },
    occurred_at: t0,
  });
  const fsId = insertEvent({
    project_id: projectId,
    source: 'fs_watch',
    event_type: 'file_changed',
    payload: {
      files: ['src/auth/login.ts'],
      change_types: ['added'],
      window_start: t0 + 1000,
      window_end: t0 + 5000,
    },
    occurred_at: t0 + 5000,
  });
  const commitId = insertEvent({
    project_id: projectId,
    source: 'commit',
    event_type: 'commit',
    payload: {
      sha: 'aaa111',
      message: 'feat: implement email login',
      files_changed: ['src/auth/login.ts'],
      lines_added: 50,
      lines_deleted: 0,
      author: 'a@b.c',
      branch: 'main',
    },
    occurred_at: t0 + 10000,
  });

  const report = reconcile(projectId);
  check(
    'all 3 events attributed',
    report.events_attributed === 3,
    `got ${report.events_attributed}`,
  );
  check('strong signal creates new reconciled run', report.runs_created === 1);

  const e1 = eventRow(mcpId);
  const e2 = eventRow(fsId);
  const e3 = eventRow(commitId);
  check(
    'all events linked to same run',
    e1.ai_run_id === e2.ai_run_id && e2.ai_run_id === e3.ai_run_id,
    `${e1.ai_run_id} / ${e2.ai_run_id} / ${e3.ai_run_id}`,
  );
  check(
    'all events linked to correct feature',
    e1.feature_node_id === feature.id,
  );

  const runs = listRunsByNode(feature.id);
  check('one run on feature', runs.length === 1);
  check(
    'run has files_touched from window',
    runs[0]!.files_touched?.includes('src/auth/login.ts') ?? false,
    runs[0]!.files_touched ?? '<null>',
  );
}

function scenarioMediumActive(projectId: string): void {
  console.log('\n── Scenario B: medium signal (existing running run overlaps)');
  const feature = createNode({
    project_id: projectId,
    kind: 'feature',
    title: 'Existing Active',
    source: 'user',
  });
  const runStart = Date.now();
  const run = createRun({
    feature_node_id: feature.id,
    client_type: 'claude_code',
    intent: 'fix',
    run_status: 'running',
    origin: 'mcp',
    started_at: runStart,
  });

  const commitId = insertEvent({
    project_id: projectId,
    source: 'commit',
    event_type: 'commit',
    payload: {
      sha: 'bbb222',
      message: 'chore: drive-by change',
      files_changed: ['unrelated.ts'],
      lines_added: 3,
      lines_deleted: 1,
      author: 'a@b.c',
      branch: 'main',
    },
    occurred_at: runStart + 5000,
  });

  const report = reconcile(projectId);
  const e = eventRow(commitId);
  check(
    'commit linked to existing run',
    e.ai_run_id === run.id,
    `linked to ${e.ai_run_id}`,
  );
  check(
    'no new run created',
    report.runs_created === 0,
    `created=${report.runs_created}`,
  );
  const refreshed = getRun(run.id)!;
  check(
    'running run finalized to completed',
    refreshed.run_status === 'completed',
    refreshed.run_status,
  );
}

function scenarioMediumKeyword(projectId: string): void {
  console.log('\n── Scenario C: medium signal (commit keyword)');
  const feature = createNode({
    project_id: projectId,
    kind: 'feature',
    title: 'Password reset',
    source: 'user',
  });

  const t0 = Date.now() - 1000 * 60 * 60 * 24; // yesterday, no overlap with any existing run
  const commitId = insertEvent({
    project_id: projectId,
    source: 'commit',
    event_type: 'commit',
    payload: {
      sha: 'ccc333',
      message: 'feat: scaffold password reset endpoints',
      files_changed: ['src/auth/reset.ts'],
      lines_added: 30,
      lines_deleted: 0,
      author: 'a@b.c',
      branch: 'main',
    },
    occurred_at: t0,
  });

  const report = reconcile(projectId);
  const e = eventRow(commitId);
  check(
    'commit linked to keyword-matched feature',
    e.feature_node_id === feature.id,
  );
  check('keyword match creates new reconciled run', report.runs_created >= 1);

  const runs = listRunsByNode(feature.id);
  const reconciledRun = runs.find((r) => r.origin === 'reconciled');
  check('reconciled run exists', reconciledRun !== undefined);
  check(
    'intent inferred from message',
    reconciledRun?.intent === 'implement',
    reconciledRun?.intent,
  );
}

function scenarioWeakOverlap(projectId: string): void {
  console.log('\n── Scenario D: weak signal (file overlap)');
  const feature = createNode({
    project_id: projectId,
    kind: 'feature',
    title: 'DB Migrations',
    source: 'user',
  });

  const runStart = Date.now();
  const run = createRun({
    feature_node_id: feature.id,
    client_type: 'claude_code',
    intent: 'implement',
    run_status: 'running',
    origin: 'mcp',
    files_touched: ['migrations/001.sql', 'migrations/002.sql'],
    started_at: runStart,
  });

  const fsId = insertEvent({
    project_id: projectId,
    source: 'fs_watch',
    event_type: 'file_changed',
    payload: {
      files: ['migrations/001.sql', 'migrations/002.sql', 'migrations/003.sql'],
      change_types: ['modified', 'modified', 'added'],
      window_start: runStart + 1000,
      window_end: runStart + 6000,
    },
    occurred_at: runStart + 6000,
  });

  const report = reconcile(projectId);
  const e = eventRow(fsId);
  check(
    'fs_watch linked to overlapping run',
    e.ai_run_id === run.id,
    `linked to ${e.ai_run_id}`,
  );
  check('weak match did not create new run', report.runs_created === 0);
}

function scenarioFailure(projectId: string): void {
  console.log('\n── Scenario E: no signal → unattributed');
  const orphanFsId = insertEvent({
    project_id: projectId,
    source: 'fs_watch',
    event_type: 'file_changed',
    payload: {
      files: ['totally/unrelated/file.txt'],
      change_types: ['modified'],
      window_start: 1,
      window_end: 100,
    },
    occurred_at: 100,
  });

  const report = reconcile(projectId);
  const e = eventRow(orphanFsId);
  check('orphan event reconciled=2', e.reconciled === 2);
  check(
    'unattributed counted',
    report.events_unattributed >= 1,
    `unattributed=${report.events_unattributed}`,
  );
}

function main(): void {
  const sandbox = mkdtempSync(join(tmpdir(), 'compass-recon-'));
  process.env.COMPASS_DATA_DIR = join(sandbox, '.compass');
  console.log(`[recon] sandbox=${sandbox}`);

  try {
    migrate();

    const projects: Record<string, string> = {
      A: ensureProject(join(sandbox, 'A'), 'A').id,
      B: ensureProject(join(sandbox, 'B'), 'B').id,
      C: ensureProject(join(sandbox, 'C'), 'C').id,
      D: ensureProject(join(sandbox, 'D'), 'D').id,
      E: ensureProject(join(sandbox, 'E'), 'E').id,
    };

    scenarioStrong(projects.A!);
    scenarioMediumActive(projects.B!);
    scenarioMediumKeyword(projects.C!);
    scenarioWeakOverlap(projects.D!);
    scenarioFailure(projects.E!);

    const failed = results.filter((r) => !r.ok);
    const passRate = ((results.length - failed.length) / results.length) * 100;
    console.log(
      `\n[recon] ${results.length - failed.length}/${results.length} checks passed (${passRate.toFixed(0)}%)`,
    );
    if (failed.length > 0) {
      console.error('[recon] FAIL');
      for (const f of failed) console.error(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`);
      process.exitCode = 1;
    } else {
      console.log('[recon] PASS — all signal levels attribute correctly');
    }
  } finally {
    closeDb();
    rmSync(sandbox, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error('[recon] fatal:', err);
  process.exit(1);
}
