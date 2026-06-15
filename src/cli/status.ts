import { resolve } from 'node:path';
import { closeDb, openDb } from '../db/connection.ts';
import { migrate } from '../db/migrate.ts';
import { findProjectByRoot, type Project } from '../db/projects.ts';
import { dbPath } from '../shared/paths.ts';

interface AggregateRow {
  total_events: number;
  mcp_call_events: number;
  commit_events: number;
  fs_watch_events: number;
  unattributed: number;
}

interface RunRow {
  id: string;
  feature_node_id: string;
  client_type: string;
  intent: string;
  run_status: string;
  origin: string;
  summary: string | null;
  started_at: number;
}

interface McpRow {
  id: string;
  payload: string;
  occurred_at: number;
}

interface NodeRow {
  id: string;
  title: string;
  status: string;
  phase: string;
}

function loadProject(): Project | null {
  const root = resolve(process.env.COMPASS_PROJECT_ROOT ?? process.cwd());
  return findProjectByRoot(root);
}

function formatTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(ms).toISOString().split('T')[0]!;
}

export function statusCli(rawArgs: string[]): void {
  let runsLimit = 10;
  let callsLimit = 20;
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    const next = rawArgs[i + 1];
    if (a === '--runs' && next) {
      runsLimit = Number(next);
      i++;
    } else if (a === '--calls' && next) {
      callsLimit = Number(next);
      i++;
    }
  }

  migrate();
  try {
    const project = loadProject();
    console.log(`compass status`);
    console.log(`──────────────`);
    console.log(`db:            ${dbPath()}`);
    if (!project) {
      console.log(
        `\nNo project registered for ${process.env.COMPASS_PROJECT_ROOT ?? process.cwd()}.`,
      );
      console.log(
        `It will be auto-created when an MCP tool fires or a git commit is captured.`,
      );
      return;
    }
    console.log(`project:       ${project.name} (${project.id})`);
    console.log(`root:          ${project.root_path}`);
    console.log(`active_phase:  ${project.active_phase}`);

    const db = openDb();

    const agg = db
      .prepare(
        `SELECT
           COUNT(*) AS total_events,
           SUM(CASE WHEN source = 'mcp_call' THEN 1 ELSE 0 END) AS mcp_call_events,
           SUM(CASE WHEN source = 'commit' THEN 1 ELSE 0 END) AS commit_events,
           SUM(CASE WHEN source = 'fs_watch' THEN 1 ELSE 0 END) AS fs_watch_events,
           SUM(CASE WHEN reconciled = 2 THEN 1 ELSE 0 END) AS unattributed
         FROM activity_events WHERE project_id = ?`,
      )
      .get(project.id) as AggregateRow;

    console.log(`\nactivity_events (all-time):`);
    console.log(`  total:        ${agg.total_events ?? 0}`);
    console.log(`  mcp_call:     ${agg.mcp_call_events ?? 0}`);
    console.log(`  commit:       ${agg.commit_events ?? 0}`);
    console.log(`  fs_watch:     ${agg.fs_watch_events ?? 0}`);
    console.log(`  unattributed: ${agg.unattributed ?? 0}`);

    const nodeCounts = db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM feature_nodes
         WHERE project_id = ? GROUP BY status`,
      )
      .all(project.id) as Array<{ status: string; n: number }>;
    console.log(`\nfeature_nodes:`);
    const total = nodeCounts.reduce((s, r) => s + r.n, 0);
    console.log(`  total: ${total}`);
    for (const r of nodeCounts) console.log(`    ${r.status.padEnd(20)} ${r.n}`);

    const runs = db
      .prepare(
        `SELECT ai_runs.id, ai_runs.feature_node_id, ai_runs.client_type, ai_runs.intent,
                ai_runs.run_status, ai_runs.origin, ai_runs.summary, ai_runs.started_at
         FROM ai_runs
         JOIN feature_nodes ON feature_nodes.id = ai_runs.feature_node_id
         WHERE feature_nodes.project_id = ?
         ORDER BY ai_runs.started_at DESC
         LIMIT ?`,
      )
      .all(project.id, runsLimit) as RunRow[];

    console.log(`\nrecent ai_runs (top ${runsLimit}):`);
    if (runs.length === 0) console.log('  (none)');
    for (const r of runs) {
      const node = db
        .prepare('SELECT title FROM feature_nodes WHERE id = ?')
        .get(r.feature_node_id) as { title: string } | undefined;
      console.log(
        `  ${formatTime(r.started_at).padStart(8)}  ${r.run_status.padEnd(10)} ${r.origin.padEnd(11)} ${r.client_type.padEnd(15)} ${node?.title ?? '<deleted>'}`,
      );
      if (r.summary)
        console.log(`           ${r.summary.split('\n')[0]?.slice(0, 80)}`);
    }

    const calls = db
      .prepare(
        `SELECT id, payload, occurred_at FROM activity_events
         WHERE project_id = ? AND source = 'mcp_call'
         ORDER BY occurred_at DESC LIMIT ?`,
      )
      .all(project.id, callsLimit) as McpRow[];

    console.log(`\nrecent mcp_call events (top ${callsLimit}):`);
    if (calls.length === 0) console.log('  (none)');
    for (const c of calls) {
      let toolName = '?';
      let clientType = '?';
      try {
        const p = JSON.parse(c.payload) as {
          tool_name?: string;
          client_type?: string;
        };
        toolName = p.tool_name ?? '?';
        clientType = p.client_type ?? '?';
      } catch {
        // ignore
      }
      console.log(
        `  ${formatTime(c.occurred_at).padStart(8)}  ${toolName.padEnd(36)} ${clientType}`,
      );
    }

    const recentNodes = db
      .prepare(
        `SELECT id, title, status, phase FROM feature_nodes
         WHERE project_id = ? AND status IN ('ai_completed','needs_user_action','broken')
         ORDER BY updated_at DESC LIMIT 10`,
      )
      .all(project.id) as NodeRow[];

    if (recentNodes.length > 0) {
      console.log(`\nattention needed:`);
      for (const n of recentNodes) {
        console.log(`  ${n.status.padEnd(20)} ${n.phase.padEnd(8)} ${n.title}`);
      }
    }

    // Roadmap: show v2/v3 features with priority + estimate
    const roadmap = db
      .prepare(
        `SELECT title, phase, priority, estimate, status FROM feature_nodes
         WHERE project_id = ? AND phase IN ('v2','v3') AND kind != 'module'
         ORDER BY phase, priority, title`,
      )
      .all(project.id) as Array<{
      title: string;
      phase: string;
      priority: string | null;
      estimate: string | null;
      status: string;
    }>;

    if (roadmap.length > 0) {
      console.log(`\nroadmap:`);
      let currentPhase = '';
      for (const r of roadmap) {
        if (r.phase !== currentPhase) {
          currentPhase = r.phase;
          console.log(`  ── ${currentPhase} ──`);
        }
        const pri = r.priority ? r.priority.padEnd(3) : '   ';
        const est = r.estimate ? ` (${r.estimate})` : '';
        const st = r.status !== 'planned' ? ` [${r.status}]` : '';
        console.log(`  ${pri} ${r.title}${est}${st}`);
      }
    }
  } finally {
    closeDb();
  }
}
