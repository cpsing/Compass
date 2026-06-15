import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../src/db/migrate.ts';
import { ensureProject } from '../src/db/projects.ts';
import { createNode } from '../src/db/feature-nodes.ts';
import {
  insertEvent,
  listUnattributed,
  countUnattributed,
} from '../src/db/events.ts';
import { reconcile } from '../src/reconciler/index.ts';
import { assignOrphansToNode } from '../src/services/orphan-assign.ts';
import { listRunsByNode, parseFilesTouched } from '../src/db/ai-runs.ts';
import { openDb, closeDb } from '../src/db/connection.ts';

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}
const results: Check[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  console.log(`  [${ok ? 'OK' : 'FAIL'}] ${name}${detail ? '  — ' + detail : ''}`);
}

function main(): void {
  const sandbox = mkdtempSync(join(tmpdir(), 'compass-orphans-'));
  process.env.COMPASS_DATA_DIR = join(sandbox, '.compass');
  console.log(`[orphans] sandbox=${sandbox}`);

  try {
    migrate();
    const project = ensureProject(sandbox, 'orphans-test');

    // Build a feature so we have a target for assignment
    const module = createNode({
      project_id: project.id,
      kind: 'module',
      title: 'Misc',
      source: 'user',
    });
    const feature = createNode({
      project_id: project.id,
      parent_id: module.id,
      kind: 'feature',
      title: 'Cleanup feature',
      source: 'user',
    });

    console.log('\n── inject 3 orphan events (no matching signal)');
    const t0 = Date.now() - 1000 * 60 * 60 * 24 * 7; // a week ago, no overlap with anything
    const e1 = insertEvent({
      project_id: project.id,
      source: 'fs_watch',
      event_type: 'file_changed',
      payload: {
        files: ['scripts/misc-a.ts'],
        change_types: ['modified'],
        window_start: t0,
        window_end: t0 + 4000,
      },
      occurred_at: t0 + 4000,
    });
    const e2 = insertEvent({
      project_id: project.id,
      source: 'commit',
      event_type: 'commit',
      payload: {
        sha: 'a1b2c3d',
        message: 'chore: tidy misc',
        files_changed: ['scripts/misc-a.ts', 'scripts/misc-b.ts'],
        lines_added: 12,
        lines_deleted: 3,
        author: 'me@test',
        branch: 'main',
      },
      occurred_at: t0 + 8000,
    });
    const e3 = insertEvent({
      project_id: project.id,
      source: 'fs_watch',
      event_type: 'file_changed',
      payload: {
        files: ['scripts/misc-c.ts'],
        change_types: ['added'],
        window_start: t0 + 9000,
        window_end: t0 + 12000,
      },
      occurred_at: t0 + 12000,
    });

    console.log('\n── reconcile (should NOT match — no MCP / no active run / no keyword / no overlap)');
    const report = reconcile(project.id);
    check(
      'reconcile marks all 3 unattributed',
      report.events_unattributed === 3,
      `unattributed=${report.events_unattributed}`,
    );

    check(
      'countUnattributed = 3',
      countUnattributed(project.id) === 3,
      `count=${countUnattributed(project.id)}`,
    );

    const orphans = listUnattributed(project.id);
    check(
      'listUnattributed returns 3 events',
      orphans.length === 3,
      `len=${orphans.length}`,
    );

    console.log('\n── assign all 3 events to feature');
    const result = assignOrphansToNode({
      event_ids: [e1, e2, e3],
      feature_node_id: feature.id,
    });
    check('assign returned ok', result.ok, result.error ?? '');
    check('events_assigned = 3', result.events_assigned === 3);

    check(
      'countUnattributed dropped to 0',
      countUnattributed(project.id) === 0,
    );

    const runs = listRunsByNode(feature.id);
    check('one ai_run on feature', runs.length === 1, `runs=${runs.length}`);
    const run = runs[0]!;
    check('run origin = reconciled', run.origin === 'reconciled');
    check('run status = completed', run.run_status === 'completed');
    check(
      'run client_type = dashboard',
      run.client_type === 'dashboard',
      run.client_type,
    );

    const files = parseFilesTouched(run);
    check(
      'files_touched union of all 3 events (3 unique)',
      files.length === 3 &&
        files.includes('scripts/misc-a.ts') &&
        files.includes('scripts/misc-b.ts') &&
        files.includes('scripts/misc-c.ts'),
      JSON.stringify(files),
    );
    check(
      'commit_sha picked from commit event',
      run.commit_sha === 'a1b2c3d',
      run.commit_sha ?? '',
    );
    check(
      'summary from first commit message',
      run.summary === 'chore: tidy misc',
      run.summary ?? '',
    );
    check(
      'run window matches first→last event',
      run.started_at === t0 + 4000 && run.completed_at === t0 + 12000,
      `${run.started_at} → ${run.completed_at}`,
    );

    // Verify activity_events were marked reconciled=1 with correct feature_node_id
    const db = openDb();
    const rows = db
      .prepare(
        "SELECT reconciled, ai_run_id, feature_node_id FROM activity_events WHERE project_id = ? ORDER BY occurred_at ASC",
      )
      .all(project.id) as Array<{
      reconciled: number;
      ai_run_id: string;
      feature_node_id: string;
    }>;
    check(
      'all 3 events now reconciled=1',
      rows.every((r) => r.reconciled === 1),
    );
    check(
      'all 3 events linked to the same ai_run + feature',
      rows.every((r) => r.ai_run_id === run.id && r.feature_node_id === feature.id),
    );

    console.log('\n── trust: cannot re-assign an already-attributed event');
    const reassign = assignOrphansToNode({
      event_ids: [e1],
      feature_node_id: feature.id,
    });
    check(
      'reject already-attributed event',
      !reassign.ok && /unattributed/.test(reassign.error ?? ''),
      reassign.error ?? '',
    );

    console.log('\n── trust: cannot assign across projects');
    const otherProject = ensureProject(join(sandbox, 'other'), 'other');
    const otherFeature = createNode({
      project_id: otherProject.id,
      kind: 'module',
      title: 'Other',
      source: 'user',
    });
    // Insert a fresh orphan to test cross-project
    const eX = insertEvent({
      project_id: project.id,
      source: 'fs_watch',
      event_type: 'file_changed',
      payload: { files: ['x.ts'], change_types: ['modified'], window_start: 1, window_end: 2 },
      occurred_at: t0 + 20000,
    });
    reconcile(project.id);
    const crossProject = assignOrphansToNode({
      event_ids: [eX],
      feature_node_id: otherFeature.id,
    });
    check(
      'reject cross-project assign',
      !crossProject.ok && /different project/.test(crossProject.error ?? ''),
      crossProject.error ?? '',
    );

    const failed = results.filter((r) => !r.ok);
    console.log(`\n[orphans] ${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length > 0) {
      console.error('[orphans] FAIL');
      process.exitCode = 1;
    } else {
      console.log('[orphans] PASS');
    }
  } finally {
    closeDb();
    rmSync(sandbox, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error('[orphans] fatal:', err);
  process.exit(1);
}
