/**
 * Seed v2 + v3 roadmap into the dogfood project.
 * Maps the optimization priority table (P0-P3) into feature nodes
 * with priority + estimate fields, split across v2 and v3 phases.
 *
 * v2 = P0 + P1 + some P2 items (near-term, ~2-3 weeks)
 * v3 = remaining P2 + P3 items (longer-term, ~1-2 months)
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../src/db/migrate.ts';
import { ensureProject } from '../src/db/projects.ts';
import { createNode, listProjectNodes } from '../src/db/feature-nodes.ts';
import {
  setPhase,
  setPriorityEstimate,
} from '../src/db/feature-node-mutations.ts';
import { createTodo } from '../src/db/code-todos.ts';
import { openDb, closeDb } from '../src/db/connection.ts';

// ── Roadmap definition ────────────────────────────────────────────
// Each entry: [title, description, phase, priority, estimate, todos[]]

const V2_SETUP_DX: Array<{
  title: string;
  desc: string;
  priority: string;
  estimate: string;
  todos: Array<{ content: string; file: string }>;
}> = [
  {
    title: 'npx distribution + compass init',
    desc: 'Publish to npm so users can `npx compass init` without cloning the repo. compass init runs migrate + ensureProject + install-hook + generate .mcp.json in one step.',
    priority: 'P0',
    estimate: '2-3 days',
    todos: [
      { content: 'Configure package.json for npm publish (name, version, files field)', file: 'package.json' },
      { content: 'Add bin entry for compass-cli and compass-mcp launchers', file: 'package.json' },
      { content: 'Implement compass init subcommand', file: 'src/cli/init.ts' },
      { content: 'Detect project type (Node/Python/Go) for smart .mcp.json generation', file: 'src/cli/init.ts' },
    ],
  },
  {
    title: 'compass start — unified launcher',
    desc: 'Single command to start daemon + dashboard. Fork child processes, print summary, handle SIGINT for graceful shutdown. No more 3 terminals.',
    priority: 'P0',
    estimate: '1 day',
    todos: [
      { content: 'Fork daemon + next dev as child processes', file: 'src/cli/start.ts' },
      { content: 'Print startup summary (dashboard URL, data dir, project root)', file: 'src/cli/start.ts' },
    ],
  },
  {
    title: 'compass today — terminal daily summary',
    desc: 'Quick morning check: verified/pending/broken counts, test queue with steps, last AI activity by client, unreconciled commits. 10x faster than opening browser.',
    priority: 'P1',
    estimate: '1-2 days',
    todos: [
      { content: 'Implement status summary formatter (counts + test queue + AI activity)', file: 'src/cli/today.ts' },
    ],
  },
  {
    title: 'MCP Resources — passive context push',
    desc: 'Register compass://project/status as MCP Resource. Clients auto-fetch project state at session start. AI no longer needs to proactively call compass_list_features.',
    priority: 'P1',
    estimate: '2 days',
    todos: [
      { content: 'Implement server.registerResource() with project status markdown', file: 'src/mcp/server.ts' },
      { content: 'Add compass://feature/{id}/detail resource for per-node context', file: 'src/mcp/server.ts' },
    ],
  },
  {
    title: 'Auto-detect client_type from MCP handshake',
    desc: 'Read clientInfo from MCP initialize request instead of requiring COMPASS_CLIENT_TYPE env var. Fallback to parent process detection.',
    priority: 'P1',
    estimate: '0.5 days',
    todos: [
      { content: 'Extract clientInfo from MCP initialize request params', file: 'src/mcp/context.ts' },
    ],
  },
  {
    title: 'Config file (~/.compass/config.yaml)',
    desc: 'Single source of truth replacing scattered env vars. All components (MCP server, dashboard, CLI) read the same file. Eliminates COMPASS_DATA_DIR mismatch bugs.',
    priority: 'P2',
    estimate: '1 day',
    todos: [
      { content: 'Implement config loader with env var fallback', file: 'src/shared/config.ts' },
      { content: 'Update all components to read from config file', file: 'src/mcp/context.ts' },
    ],
  },
  {
    title: 'compass reconcile — manual trigger CLI',
    desc: 'Let users run reconciliation on demand. Show report: events attributed, runs created, unattributed count.',
    priority: 'P2',
    estimate: '0.5 days',
    todos: [
      { content: 'Wire reconcile() into CLI subcommand with report output', file: 'src/cli/reconcile.ts' },
    ],
  },
  {
    title: 'MCP Prompts — built-in workflow templates',
    desc: 'Register reusable prompts: "continue previous work", "review what AI did today", "handoff to another tool". Users select from a menu instead of typing.',
    priority: 'P2',
    estimate: '1 day',
    todos: [
      { content: 'Implement compass-continue-work prompt', file: 'src/mcp/server.ts' },
      { content: 'Implement compass-review-today prompt', file: 'src/mcp/server.ts' },
    ],
  },
];

const V3_PLATFORM: Array<{
  title: string;
  desc: string;
  priority: string;
  estimate: string;
  todos: Array<{ content: string; file: string }>;
}> = [
  {
    title: 'Terminal notifications on AI run completion',
    desc: 'When finish_ai_run is called, emit terminal bell + optional OS notification (osascript/notify-send). User doesn\'t need to watch the dashboard.',
    priority: 'P3',
    estimate: '0.5 days',
    todos: [
      { content: 'Add notification emitter (bell + osascript + notify-send)', file: 'src/mcp/notify.ts' },
      { content: 'Hook into finish_ai_run handler', file: 'src/mcp/tools/finish-ai-run.ts' },
    ],
  },
  {
    title: 'Import from GitHub Issues / Linear / Markdown',
    desc: '`compass import --from github-issues` / `--from linear` / `--from markdown TODO.md`. Batch-create feature tree from existing project management. Reduces cold-start cost.',
    priority: 'P3',
    estimate: '2-3 days',
    todos: [
      { content: 'GitHub Issues importer via gh CLI (labels → modules, milestones → phases)', file: 'src/cli/import/github.ts' },
      { content: 'Linear importer via GraphQL API', file: 'src/cli/import/linear.ts' },
      { content: 'Markdown TODO importer (## headings → features, - [ ] → tasks)', file: 'src/cli/import/markdown.ts' },
    ],
  },
  {
    title: 'VSCode/Cursor native extension',
    desc: 'Sidebar panel showing Compass feature tree + test queue. Status bar shows current phase and in-progress count. Auto-registers MCP server. No manual .mcp.json needed.',
    priority: 'P3',
    estimate: '1-2 weeks',
    todos: [
      { content: 'Tree view provider using vscode.TreeDataProvider API', file: 'extensions/vscode/src/tree.ts' },
      { content: 'Status bar item showing phase + counts', file: 'extensions/vscode/src/statusbar.ts' },
    ],
  },
];

// ── Bonus v3 items from architecture docs (no priority assigned) ──
const V3_BONUS: Array<{
  title: string;
  desc: string;
  todos: Array<{ content: string; file: string }>;
}> = [
  {
    title: 'Dashboard PWA — installable desktop app',
    desc: 'manifest.json + service worker. Users install the dashboard as a desktop app.',
    todos: [
      { content: 'Add manifest.json with app icons and theme colors', file: 'app/manifest.json' },
      { content: 'Service worker for offline dashboard shell caching', file: 'app/sw.ts' },
    ],
  },
  {
    title: 'Export & weekly report generation',
    desc: '`compass export --format markdown` generates a weekly status report.',
    todos: [
      { content: 'Markdown export formatter with per-week grouping', file: 'src/cli/export.ts' },
    ],
  },
  {
    title: 'Multi-device sync (cloud layer)',
    desc: 'SQLite → CRDT or last-write-wins sync via cloud endpoint. Pro tier feature.',
    todos: [],
  },
  {
    title: 'Client capability declarations',
    desc: 'Each AI client declares capabilities. Compass suggests the best tool for a task.',
    todos: [],
  },
  {
    title: 'Team collaboration — shared project state',
    desc: 'Multiple developers share Compass state. Shared test queue.',
    todos: [],
  },
];

async function main(): Promise<void> {
  migrate();

  const projectRoot = join(homedir(), 'compass-dev');
  const project = ensureProject(projectRoot, 'compass');

  // Register v2 + v3 as known phases
  const db = openDb();
  db.prepare(
    "UPDATE projects SET known_phases = '[\"v1\",\"v2\",\"v3\"]' WHERE id = ?",
  ).run(project.id);
  // Don't close — openDb() returns shared singleton

  // ── Clean up old v2/v3 nodes (idempotent re-seed) ──────────────
  const existing = listProjectNodes(project.id);
  const oldV2V3 = existing.filter(
    (n) =>
      (n.phase === 'v2' || n.phase === 'v3') &&
      n.kind !== 'module',
  );
  if (oldV2V3.length > 0) {
    console.log(`[roadmap] removing ${oldV2V3.length} old v2/v3 feature nodes for clean re-seed`);
    const dbClean = openDb();
    for (const n of oldV2V3) {
      dbClean.prepare('DELETE FROM feature_nodes WHERE id = ?').run(n.id);
    }
    // Also remove old modules in v2/v3
    const oldModules = existing.filter(
      (n) =>
        (n.phase === 'v2' || n.phase === 'v3') && n.kind === 'module',
    );
    for (const m of oldModules) {
      dbClean.prepare('DELETE FROM feature_nodes WHERE id = ?').run(m.id);
    }
    // Don't close — openDb() returns shared singleton
  }

  console.log('[roadmap] known_phases → ["v1","v2","v3"]');

  // ── Seed v2: Setup & DX ────────────────────────────────────────
  const setupDX = createNode({
    project_id: project.id,
    kind: 'module',
    title: 'Setup & DX',
    source: 'user',
    description: 'Reduce onboarding friction and improve daily developer experience.',
    phase: 'v2',
  });

  for (const item of V2_SETUP_DX) {
    const node = createNode({
      project_id: project.id,
      parent_id: setupDX.id,
      kind: 'feature',
      title: item.title,
      description: item.desc,
      source: 'user',
      phase: 'v2',
      priority: item.priority as any,
      estimate: item.estimate,
    });
    setPriorityEstimate(node.id, item.priority, item.estimate);
    for (const todo of item.todos) {
      createTodo({
        feature_node_id: node.id,
        content: todo.content,
        file_path: todo.file,
        created_by: 'ai',
      });
    }
    console.log(`[roadmap] v2 ${item.priority} ${item.title} (${item.estimate})`);
  }

  // ── Seed v2: MCP Enhancements ──────────────────────────────────
  // (MCP Resources, Auto-detect, MCP Prompts are already under Setup & DX
  //  but logically they're MCP enhancements — kept together for simplicity)

  // ── Seed v3: Platform & Ecosystem ──────────────────────────────
  const platform = createNode({
    project_id: project.id,
    kind: 'module',
    title: 'Platform & Ecosystem',
    source: 'user',
    description: 'Expand Compass beyond local CLI tool into a platform with IDE integrations, import/export, and multi-device support.',
    phase: 'v3',
  });

  for (const item of V3_PLATFORM) {
    const node = createNode({
      project_id: project.id,
      parent_id: platform.id,
      kind: 'feature',
      title: item.title,
      description: item.desc,
      source: 'user',
      phase: 'v3',
      priority: item.priority as any,
      estimate: item.estimate,
    });
    setPriorityEstimate(node.id, item.priority, item.estimate);
    for (const todo of item.todos) {
      createTodo({
        feature_node_id: node.id,
        content: todo.content,
        file_path: todo.file,
        created_by: 'ai',
      });
    }
    console.log(`[roadmap] v3 ${item.priority} ${item.title} (${item.estimate})`);
  }

  for (const item of V3_BONUS) {
    const node = createNode({
      project_id: project.id,
      parent_id: platform.id,
      kind: 'feature',
      title: item.title,
      description: item.desc,
      source: 'user',
      phase: 'v3',
    });
    // No priority/estimate for bonus items
    for (const todo of item.todos) {
      createTodo({
        feature_node_id: node.id,
        content: todo.content,
        file_path: todo.file,
        created_by: 'ai',
      });
    }
    console.log(`[roadmap] v3 (bonus) ${item.title}`);
  }

  // ── Summary ────────────────────────────────────────────────────
  const finalNodes = listProjectNodes(project.id);
  const v1 = finalNodes.filter((n) => n.phase === 'v1' && n.kind !== 'module').length;
  const v2 = finalNodes.filter((n) => n.phase === 'v2' && n.kind !== 'module').length;
  const v3 = finalNodes.filter((n) => n.phase === 'v3' && n.kind !== 'module').length;

  const p0 = finalNodes.filter((n) => n.priority === 'P0').length;
  const p1 = finalNodes.filter((n) => n.priority === 'P1').length;
  const p2 = finalNodes.filter((n) => n.priority === 'P2').length;
  const p3 = finalNodes.filter((n) => n.priority === 'P3').length;

  console.log();
  console.log('[roadmap] Roadmap seeded');
  console.log(`[roadmap]   v1: ${v1} features (current sprint)`);
  console.log(`[roadmap]   v2: ${v2} features (near-term)`);
  console.log(`[roadmap]   v3: ${v3} features (longer-term)`);
  console.log(`[roadmap]   Priority: P0=${p0}  P1=${p1}  P2=${p2}  P3=${p3}`);
  console.log(`[roadmap]   Dashboard: http://localhost:18737`);

  closeDb();
}

main().catch((err) => {
  console.error('[roadmap] fatal:', err);
  process.exit(1);
});
