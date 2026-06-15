/**
 * Dogfood seed — populate Compass with its OWN feature tree.
 * This lets us track Compass development using Compass itself.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../src/db/migrate.ts';
import { ensureProject } from '../src/db/projects.ts';
import { createNode } from '../src/db/feature-nodes.ts';
import {
  updateStatus,
  touchByClient,
  setTestSteps,
  setActiveAiRun,
} from '../src/db/feature-node-mutations.ts';
import { createRun } from '../src/db/ai-runs.ts';
import { createTodo } from '../src/db/code-todos.ts';
import { openDb, closeDb } from '../src/db/connection.ts';

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;

async function main(): Promise<void> {
  migrate();

  const projectRoot = join(homedir(), 'compass-dev');
  const project = ensureProject(projectRoot, 'compass');
  console.log(`[dogfood] project ${project.id} root=${projectRoot}`);

  // Mark v2 known so deferred features can exist
  const db = openDb();
  db.prepare("UPDATE projects SET known_phases = '[\"v1\",\"v2\"]' WHERE id = ?").run(project.id);
  closeDb();

  // ================================================================
  // MODULE: MCP Server
  // ================================================================
  const mcp = createNode({
    project_id: project.id,
    kind: 'module',
    title: 'MCP Server',
    source: 'user',
    description: 'MCP (Model Context Protocol) server exposing 13 compass_* tools to AI clients via stdio.',
  });

  // MCP > Tool Surface (verified)
  const toolSurface = createNode({
    project_id: project.id,
    parent_id: mcp.id,
    kind: 'feature',
    title: '13 MCP Tools',
    description: 'list_features, get_feature, list_subtree, list_todos, start/finish_ai_run, update_status, create_node, add_todo, defer, log_test_steps, handoff_brief, client_activity.',
    source: 'user',
  });
  updateStatus({ id: toolSurface.id, status: 'verified', caller: 'user' });
  setTestSteps(toolSurface.id, '- Run smoke:mcp → all 13 tools respond\n- Verify tool descriptions in Claude Code');
  touchByClient(toolSurface.id, 'claude_code');
  createRun({
    feature_node_id: toolSurface.id,
    client_type: 'claude_code',
    intent: 'implement',
    run_status: 'completed',
    origin: 'mcp',
    plan: '1. Register all 13 tools in server.ts\n2. Implement each tool module\n3. Add Zod input validation',
    summary: 'All 13 tools implemented and passing smoke tests.',
    files_touched: ['src/mcp/server.ts', 'src/mcp/tools/list-features.ts', 'src/mcp/tools/start-ai-run.ts'],
    started_at: NOW - DAY * 5,
    completed_at: NOW - DAY * 5 + HOUR * 3,
  });

  // MCP > Handoff Brief (verified)
  const handoff = createNode({
    project_id: project.id,
    parent_id: mcp.id,
    kind: 'feature',
    title: 'Handoff Brief Generator',
    description: 'compass_generate_handoff_brief: assembles markdown brief from parent feature, recent AIRuns, files touched, code todos.',
    source: 'user',
  });
  updateStatus({ id: handoff.id, status: 'verified', caller: 'user' });
  touchByClient(handoff.id, 'cursor');
  createRun({
    feature_node_id: handoff.id,
    client_type: 'cursor',
    intent: 'implement',
    run_status: 'completed',
    origin: 'mcp',
    plan: '1. Query parent + children + recent runs\n2. Assemble markdown server-side\n3. Control token count (800-1500)',
    summary: 'Handoff brief implemented. Generates consistent markdown with run status clearly labeled.',
    files_touched: ['src/mcp/tools/handoff-brief.ts'],
    started_at: NOW - DAY * 3,
    completed_at: NOW - DAY * 3 + HOUR * 2,
  });

  // MCP > Client Auto-Detection (planned — optimization)
  const clientDetect = createNode({
    project_id: project.id,
    parent_id: mcp.id,
    kind: 'feature',
    title: 'Auto-detect client_type',
    description: 'Infer client type from MCP initialize handshake or parent process instead of requiring COMPASS_CLIENT_TYPE env var.',
    source: 'user',
  });
  // stays planned — optimization item

  // ================================================================
  // MODULE: Database
  // ================================================================
  const dbMod = createNode({
    project_id: project.id,
    kind: 'module',
    title: 'Database Layer',
    source: 'user',
    description: 'SQLite via better-sqlite3. Schema, migrations, typed accessors.',
  });

  // DB > Schema + Migrations (verified)
  const schema = createNode({
    project_id: project.id,
    parent_id: dbMod.id,
    kind: 'feature',
    title: 'Schema & Migrations',
    description: '7 tables + 1 view. Idempotent via IF NOT EXISTS. WAL mode.',
    source: 'user',
  });
  updateStatus({ id: schema.id, status: 'verified', caller: 'user' });
  setTestSteps(schema.id, '- Run npm run migrate → db created\n- Re-run → idempotent, no errors');
  touchByClient(schema.id, 'claude_code');

  // DB > Feature Nodes CRUD (verified)
  const nodesCRUD = createNode({
    project_id: project.id,
    parent_id: dbMod.id,
    kind: 'feature',
    title: 'Feature Nodes CRUD',
    description: 'Self-referencing tree (module→feature→task), depth 0-3, path materialization, 7 statuses.',
    source: 'user',
  });
  updateStatus({ id: nodesCRUD.id, status: 'verified', caller: 'user' });
  touchByClient(nodesCRUD.id, 'claude_code');

  // DB > Activity Events (verified)
  const events = createNode({
    project_id: project.id,
    parent_id: dbMod.id,
    kind: 'feature',
    title: 'Activity Events Stream',
    description: 'Append-only event log: commit, fs_watch, mcp_call sources. Reconciliation tracking.',
    source: 'user',
  });
  updateStatus({ id: events.id, status: 'verified', caller: 'user' });
  touchByClient(events.id, 'cursor');

  // ================================================================
  // MODULE: Reconciler
  // ================================================================
  const reconciler = createNode({
    project_id: project.id,
    kind: 'module',
    title: 'Git Reconciler',
    source: 'user',
    description: 'Matches unreconciled activity events to AI runs via time-window grouping + attribution.',
  });

  // Reconciler > Window Grouping (verified)
  const windowing = createNode({
    project_id: project.id,
    parent_id: reconciler.id,
    kind: 'feature',
    title: 'Event Window Grouping',
    description: 'Groups events by time gap (configurable, default 5min). Each window = one potential AI run.',
    source: 'user',
  });
  updateStatus({ id: windowing.id, status: 'verified', caller: 'user' });
  touchByClient(windowing.id, 'claude_code');

  // Reconciler > Attribution Logic (verified)
  const attribution = createNode({
    project_id: project.id,
    parent_id: reconciler.id,
    kind: 'feature',
    title: 'Commit Attribution',
    description: 'Matches event windows to existing AI runs or creates new reconciled runs.',
    source: 'user',
  });
  updateStatus({ id: attribution.id, status: 'verified', caller: 'user' });
  touchByClient(attribution.id, 'claude_code');

  // Reconciler > Manual Trigger (planned — optimization)
  const manualRecon = createNode({
    project_id: project.id,
    parent_id: reconciler.id,
    kind: 'feature',
    title: 'Manual `compass reconcile` CLI',
    description: 'Let users trigger reconciliation on demand instead of relying on daemon auto-tick.',
    source: 'user',
  });
  // stays planned

  // ================================================================
  // MODULE: CLI
  // ================================================================
  const cli = createNode({
    project_id: project.id,
    kind: 'module',
    title: 'CLI',
    source: 'user',
    description: 'compass-cli: status, install-hook, capture-commit subcommands.',
  });

  // CLI > status (verified)
  const statusCmd = createNode({
    project_id: project.id,
    parent_id: cli.id,
    kind: 'feature',
    title: 'status command',
    description: 'Show project summary: feature counts by status, recent AI runs, tool call counts.',
    source: 'user',
  });
  updateStatus({ id: statusCmd.id, status: 'verified', caller: 'user' });
  touchByClient(statusCmd.id, 'claude_code');

  // CLI > install-hook (verified)
  const hookCmd = createNode({
    project_id: project.id,
    parent_id: cli.id,
    kind: 'feature',
    title: 'install-hook command',
    description: 'Install git post-commit hook. Backs up existing hook. Idempotent.',
    source: 'user',
  });
  updateStatus({ id: hookCmd.id, status: 'verified', caller: 'user' });
  touchByClient(hookCmd.id, 'claude_code');

  // CLI > compass init (planned — optimization)
  const initCmd = createNode({
    project_id: project.id,
    parent_id: cli.id,
    kind: 'feature',
    title: 'compass init (one-command setup)',
    description: 'Like git init — migrate + ensureProject + install-hook + generate .mcp.json in one step.',
    source: 'user',
  });
  // stays planned

  // CLI > compass start (planned — optimization)
  const startCmd = createNode({
    project_id: project.id,
    parent_id: cli.id,
    kind: 'feature',
    title: 'compass start (unified launcher)',
    description: 'Single command to start daemon + dashboard + show summary. No more 3 terminals.',
    source: 'user',
  });
  // stays planned

  // CLI > compass today (planned — optimization)
  const todayCmd = createNode({
    project_id: project.id,
    parent_id: cli.id,
    kind: 'feature',
    title: 'compass today (daily summary)',
    description: 'Terminal-friendly daily status: verified/pending/broken counts, test queue, last AI activity.',
    source: 'user',
  });
  // stays planned

  // ================================================================
  // MODULE: Dashboard
  // ================================================================
  const dashboard = createNode({
    project_id: project.id,
    kind: 'module',
    title: 'Dashboard (Next.js)',
    source: 'user',
    description: 'Next.js 16 App Router web UI on port 3737. Server actions for mutations.',
  });

  // Dashboard > Project Tree (ai_completed)
  const treeView = createNode({
    project_id: project.id,
    parent_id: dashboard.id,
    kind: 'feature',
    title: 'Project Tree View',
    description: 'Hierarchical feature tree with status badges, phase filter, drag-reorder.',
    source: 'user',
  });
  updateStatus({ id: treeView.id, status: 'ai_completed', caller: 'ai' });
  setTestSteps(treeView.id, '- Open http://localhost:3737\n- Verify tree renders modules→features→tasks\n- Check status badges match');
  touchByClient(treeView.id, 'cursor');
  const treeRun = createRun({
    feature_node_id: treeView.id,
    client_type: 'cursor',
    intent: 'implement',
    run_status: 'completed',
    origin: 'mcp',
    plan: '1. Server component fetches feature tree\n2. Recursive tree component\n3. Status badge + client icon per node',
    summary: 'Tree view implemented with recursive rendering. Status badges show correctly.',
    files_touched: ['app/p/[projectId]/page.tsx', 'app/actions/nodes.ts'],
    started_at: NOW - DAY * 2,
    completed_at: NOW - DAY * 2 + HOUR * 4,
  });

  // Dashboard > Test Queue (ai_completed)
  const testQueue = createNode({
    project_id: project.id,
    parent_id: dashboard.id,
    kind: 'feature',
    title: 'Test Queue',
    description: 'Shows ai_completed features with test steps. User marks pass/fail.',
    source: 'user',
  });
  updateStatus({ id: testQueue.id, status: 'ai_completed', caller: 'ai' });
  setTestSteps(testQueue.id, '- Features with status=ai_completed appear\n- Test steps shown\n- Pass/fail buttons update status');
  touchByClient(testQueue.id, 'cursor');

  // Dashboard > Client Activity View (ai_completed)
  const clientView = createNode({
    project_id: project.id,
    parent_id: dashboard.id,
    kind: 'feature',
    title: 'Client Activity View',
    description: '/clients page: per-client stats (runs, success rate, files touched). Time filter.',
    source: 'user',
  });
  updateStatus({ id: clientView.id, status: 'ai_completed', caller: 'ai' });
  touchByClient(clientView.id, 'claude_code');

  // Dashboard > Handoff Brief Page (ai_completed)
  const handoffPage = createNode({
    project_id: project.id,
    parent_id: dashboard.id,
    kind: 'feature',
    title: 'Handoff Brief Page',
    description: '/nodes/[id]/handoff: renders handoff markdown with copy button.',
    source: 'user',
  });
  updateStatus({ id: handoffPage.id, status: 'ai_completed', caller: 'ai' });
  touchByClient(handoffPage.id, 'cursor');

  // Dashboard > PWA Support (planned, v2)
  const pwa = createNode({
    project_id: project.id,
    parent_id: dashboard.id,
    kind: 'feature',
    title: 'PWA Support',
    description: 'manifest.json + service worker. Install as desktop app.',
    source: 'user',
    phase: 'v2',
  });
  void pwa;

  // ================================================================
  // MODULE: Daemon
  // ================================================================
  const daemon = createNode({
    project_id: project.id,
    kind: 'module',
    title: 'File Watcher Daemon',
    source: 'user',
    description: 'chokidar-based file watcher. Debounced event emission. Optional.',
  });

  // Daemon > File Watcher (verified)
  const watcher = createNode({
    project_id: project.id,
    parent_id: daemon.id,
    kind: 'feature',
    title: 'Chokidar File Watcher',
    description: 'Watches project root, ignores node_modules/dist/.next. 5s debounce flush.',
    source: 'user',
  });
  updateStatus({ id: watcher.id, status: 'verified', caller: 'user' });
  touchByClient(watcher.id, 'claude_code');

  // ================================================================
  // MODULE: Dogfood Improvements (the optimizations we identified)
  // ================================================================
  const improvements = createNode({
    project_id: project.id,
    kind: 'module',
    title: 'Usability Improvements',
    source: 'user',
    description: 'Optimizations identified during dogfooding to reduce setup friction and improve daily use.',
  });

  // Improvement: npx distribution (in_progress — what we're doing now)
  const npxDist = createNode({
    project_id: project.id,
    parent_id: improvements.id,
    kind: 'feature',
    title: 'npx Distribution',
    description: 'Publish to npm so users can `npx @compass-mcp/cli init` without cloning the repo.',
    source: 'user',
  });
  updateStatus({ id: npxDist.id, status: 'in_progress', caller: 'ai' });
  const npxRun = createRun({
    feature_node_id: npxDist.id,
    client_type: 'claude_code',
    intent: 'implement',
    run_status: 'running',
    origin: 'mcp',
    user_prompt_summary: 'Set up dogfooding environment for Compass',
    plan: '1. Configure dogfood dev environment\n2. Verify all components work\n3. Track development with Compass itself',
    started_at: NOW - HOUR,
  });
  setActiveAiRun(npxDist.id, npxRun.id);
  touchByClient(npxDist.id, 'claude_code');

  createTodo({
    feature_node_id: npxDist.id,
    ai_run_id: npxRun.id,
    content: 'Configure package.json for npm publish (name, version, files field)',
    file_path: 'package.json',
    line_number: 1,
    created_by: 'ai',
  });
  createTodo({
    feature_node_id: npxDist.id,
    ai_run_id: npxRun.id,
    content: 'Add bin entry for compass-cli and compass-mcp launchers',
    file_path: 'package.json',
    line_number: 7,
    created_by: 'ai',
  });

  // Improvement: MCP Resources (planned)
  const mcpResources = createNode({
    project_id: project.id,
    parent_id: improvements.id,
    kind: 'feature',
    title: 'MCP Resources (passive context push)',
    description: 'Register compass://project/status as MCP Resource so clients auto-fetch project state at session start.',
    source: 'user',
  });
  void mcpResources;

  // Improvement: Config file (planned)
  const configFile = createNode({
    project_id: project.id,
    parent_id: improvements.id,
    kind: 'feature',
    title: 'Config File (~/.compass/config.yaml)',
    description: 'Replace scattered env vars with a single config file. All components read the same source.',
    source: 'user',
  });
  void configFile;

  // Improvement: Import existing structure (planned)
  const importExisting = createNode({
    project_id: project.id,
    parent_id: improvements.id,
    kind: 'feature',
    title: 'Import from GitHub Issues / Linear / Markdown',
    description: 'compass import --from github-issues / linear / markdown. Reduce cold-start cost.',
    source: 'user',
  });
  void importExisting;

  console.log('[dogfood] ✓ Feature tree seeded');
  console.log(`[dogfood]   Modules: 6 (MCP Server, Database, Reconciler, CLI, Dashboard, Daemon, Improvements)`);
  console.log(`[dogfood]   Features: 22`);
  console.log(`[dogfood]   Dashboard: http://localhost:3737`);

  closeDb();
}

main().catch((err) => {
  console.error('[dogfood] fatal:', err);
  process.exit(1);
});
