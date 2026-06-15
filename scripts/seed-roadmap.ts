/**
 * Seed v2 + v3 roadmap into the dogfood project.
 * Organizes the optimization proposals from the first analysis session
 * into two future phases:
 *   v2 — Setup friction reduction & core enhancements
 *   v3 — Platform & ecosystem expansion
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../src/db/migrate.ts';
import { ensureProject } from '../src/db/projects.ts';
import { createNode, listProjectNodes } from '../src/db/feature-nodes.ts';
import { setPhase, touchByClient } from '../src/db/feature-node-mutations.ts';
import { createRun } from '../src/db/ai-runs.ts';
import { createTodo } from '../src/db/code-todos.ts';
import { openDb, closeDb } from '../src/db/connection.ts';

async function main(): Promise<void> {
  migrate();

  const projectRoot = join(homedir(), 'compass-dev');
  const project = ensureProject(projectRoot, 'compass');
  console.log(`[roadmap] project ${project.id}`);

  // ── 1. Register v2 + v3 as known phases ─────────────────────────
  const db = openDb();
  db.prepare(
    "UPDATE projects SET known_phases = '[\"v1\",\"v2\",\"v3\"]' WHERE id = ?",
  ).run(project.id);
  closeDb();
  console.log('[roadmap] known_phases updated → ["v1","v2","v3"]');

  // ── 2. Move existing "Usability Improvements" items to v2 ────────
  const allNodes = listProjectNodes(project.id);
  const improvementModule = allNodes.find(
    (n) => n.kind === 'module' && n.title === 'Usability Improvements',
  );
  if (improvementModule) {
    // Module itself stays cross-phase, but its children move to v2
    const children = allNodes.filter((n) => n.parent_id === improvementModule.id);
    for (const child of children) {
      if (child.phase !== 'v2') {
        setPhase(child.id, 'v2');
        console.log(`[roadmap] moved "${child.title}" → v2`);
      }
    }
  }

  // ── 3. Create v2 module: Setup & DX ──────────────────────────────
  const setupDX = createNode({
    project_id: project.id,
    kind: 'module',
    title: 'Setup & DX (v2)',
    source: 'user',
    description: 'Reduce onboarding friction and improve daily developer experience. Priority: make Compass usable in <2 minutes from clone.',
    phase: 'v2',
  });

  // v2 > compass init (one-command setup)
  const compassInit = createNode({
    project_id: project.id,
    parent_id: setupDX.id,
    kind: 'feature',
    title: 'compass init — one-command project setup',
    description: 'Like `git init`. Runs migrate + ensureProject + install-hook + generate .mcp.json in one step. Replaces the current 6-step manual process.',
    source: 'user',
    phase: 'v2',
  });
  createTodo({
    feature_node_id: compassInit.id,
    content: 'Detect project type (Node/Python/Go) for smart .mcp.json generation',
    file_path: 'src/cli/init.ts',
    created_by: 'ai',
  });
  createTodo({
    feature_node_id: compassInit.id,
    content: 'Add --skip-hook flag for non-git projects',
    file_path: 'src/cli/init.ts',
    created_by: 'ai',
  });

  // v2 > compass start (unified launcher)
  const compassStart = createNode({
    project_id: project.id,
    parent_id: setupDX.id,
    kind: 'feature',
    title: 'compass start — unified launcher',
    description: 'Single command to start daemon + dashboard. Fork child processes, print summary, handle SIGINT for graceful shutdown. No more 3 terminals.',
    source: 'user',
    phase: 'v2',
  });
  createTodo({
    feature_node_id: compassStart.id,
    content: 'Fork daemon + next dev as child processes',
    file_path: 'src/cli/start.ts',
    created_by: 'ai',
  });
  createTodo({
    feature_node_id: compassStart.id,
    content: 'Print startup summary (dashboard URL, data dir, project root)',
    file_path: 'src/cli/start.ts',
    created_by: 'ai',
  });

  // v2 > compass today (daily summary CLI)
  const compassToday = createNode({
    project_id: project.id,
    parent_id: setupDX.id,
    kind: 'feature',
    title: 'compass today — terminal daily summary',
    description: 'Quick morning check: verified/pending/broken counts, test queue with steps, last AI activity by client, unreconciled commits. 10x faster than opening browser.',
    source: 'user',
    phase: 'v2',
  });

  // v2 > auto-detect client_type
  const autoDetect = createNode({
    project_id: project.id,
    parent_id: setupDX.id,
    kind: 'feature',
    title: 'Auto-detect client_type from MCP handshake',
    description: 'Read clientInfo from MCP initialize request instead of requiring COMPASS_CLIENT_TYPE env var. Fallback to parent process detection.',
    source: 'user',
    phase: 'v2',
  });
  touchByClient(autoDetect.id, 'claude_code');

  // v2 > config file
  const configFile = createNode({
    project_id: project.id,
    parent_id: setupDX.id,
    kind: 'feature',
    title: 'Config file (~/.compass/config.yaml)',
    description: 'Single source of truth replacing scattered env vars. All components (MCP server, dashboard, CLI) read the same file. Eliminates COMPASS_DATA_DIR mismatch bugs.',
    source: 'user',
    phase: 'v2',
  });

  // v2 > compass reconcile manual trigger
  const manualReconcile = createNode({
    project_id: project.id,
    parent_id: setupDX.id,
    kind: 'feature',
    title: 'compass reconcile — manual trigger CLI',
    description: 'Let users run reconciliation on demand. Show report: events attributed, runs created, unattributed count. Complement to daemon auto-tick.',
    source: 'user',
    phase: 'v2',
  });

  // v2 > terminal notifications
  const notifications = createNode({
    project_id: project.id,
    parent_id: setupDX.id,
    kind: 'feature',
    title: 'Terminal notifications on AI run completion',
    description: 'When finish_ai_run is called, emit terminal bell + optional OS notification (osascript/notify-send). User doesn\'t need to watch the dashboard.',
    source: 'user',
    phase: 'v2',
  });

  // ── 4. Create v2 module: MCP Enhancements ────────────────────────
  const mcpEnhancements = createNode({
    project_id: project.id,
    kind: 'module',
    title: 'MCP Enhancements (v2)',
    source: 'user',
    description: 'Leverage MCP protocol features beyond tools: resources for passive context, prompts for templates, sampling for smarter suggestions.',
    phase: 'v2',
  });

  // v2 > MCP Resources
  const mcpResources = createNode({
    project_id: project.id,
    parent_id: mcpEnhancements.id,
    kind: 'feature',
    title: 'MCP Resources — passive context push',
    description: 'Register compass://project/status as an MCP Resource. Clients auto-fetch project state at session start. AI no longer needs to proactively call compass_list_features.',
    source: 'user',
    phase: 'v2',
  });
  createTodo({
    feature_node_id: mcpResources.id,
    content: 'Implement server.registerResource() with project status markdown',
    file_path: 'src/mcp/server.ts',
    created_by: 'ai',
  });
  createTodo({
    feature_node_id: mcpResources.id,
    content: 'Add compass://feature/{id}/detail resource for per-node context',
    file_path: 'src/mcp/server.ts',
    created_by: 'ai',
  });

  // v2 > MCP Prompts
  const mcpPrompts = createNode({
    project_id: project.id,
    parent_id: mcpEnhancements.id,
    kind: 'feature',
    title: 'MCP Prompts — built-in workflow templates',
    description: 'Register reusable prompts: "continue previous work", "review what AI did today", "handoff to another tool". Users select from a menu instead of typing.',
    source: 'user',
    phase: 'v2',
  });
  createTodo({
    feature_node_id: mcpPrompts.id,
    content: 'Implement compass-continue-work prompt (auto-fetch handoff brief)',
    file_path: 'src/mcp/server.ts',
    created_by: 'ai',
  });
  createTodo({
    feature_node_id: mcpPrompts.id,
    content: 'Implement compass-review-today prompt (daily summary)',
    file_path: 'src/mcp/server.ts',
    created_by: 'ai',
  });

  // v2 > Smarter reconciler
  const smarterReconciler = createNode({
    project_id: project.id,
    parent_id: mcpEnhancements.id,
    kind: 'feature',
    title: 'Smarter reconciler — branch-aware attribution',
    description: 'Current reconciler uses time-window + file overlap. Add: branch name matching, commit author filtering, diff-content keyword search for higher attribution accuracy.',
    source: 'user',
    phase: 'v2',
  });

  // ── 5. Create v3 module: Platform & Ecosystem ────────────────────
  const platform = createNode({
    project_id: project.id,
    kind: 'module',
    title: 'Platform & Ecosystem (v3)',
    source: 'user',
    description: 'Expand Compass beyond local CLI tool into a platform with IDE integrations, import/export, and multi-device support.',
    phase: 'v3',
  });

  // v3 > VSCode/Cursor extension
  const vscodeExt = createNode({
    project_id: project.id,
    parent_id: platform.id,
    kind: 'feature',
    title: 'VSCode/Cursor native extension',
    description: 'Sidebar panel showing Compass feature tree + test queue. Status bar shows current phase and in-progress count. Auto-registers MCP server. No manual .mcp.json needed.',
    source: 'user',
    phase: 'v3',
  });
  createTodo({
    feature_node_id: vscodeExt.id,
    content: 'Tree view provider using vscode.TreeDataProvider API',
    file_path: 'extensions/vscode/src/tree.ts',
    created_by: 'ai',
  });
  createTodo({
    feature_node_id: vscodeExt.id,
    content: 'Status bar item showing phase + counts',
    file_path: 'extensions/vscode/src/statusbar.ts',
    created_by: 'ai',
  });

  // v3 > PWA
  const pwa = createNode({
    project_id: project.id,
    parent_id: platform.id,
    kind: 'feature',
    title: 'Dashboard PWA — installable desktop app',
    description: 'manifest.json + service worker. Users "install" the dashboard as a desktop app. No more typing localhost:18737.',
    source: 'user',
    phase: 'v3',
  });
  createTodo({
    feature_node_id: pwa.id,
    content: 'Add manifest.json with app icons and theme colors',
    file_path: 'app/manifest.json',
    created_by: 'ai',
  });
  createTodo({
    feature_node_id: pwa.id,
    content: 'Service worker for offline dashboard shell caching',
    file_path: 'app/sw.ts',
    created_by: 'ai',
  });

  // v3 > Import from external sources
  const importSources = createNode({
    project_id: project.id,
    parent_id: platform.id,
    kind: 'feature',
    title: 'Import from GitHub Issues / Linear / Markdown',
    description: '`compass import --from github-issues` / `--from linear` / `--from markdown TODO.md`. Batch-create feature tree from existing project management. Reduces cold-start cost.',
    source: 'user',
    phase: 'v3',
  });
  createTodo({
    feature_node_id: importSources.id,
    content: 'GitHub Issues importer via gh CLI (labels → modules, milestones → phases)',
    file_path: 'src/cli/import/github.ts',
    created_by: 'ai',
  });
  createTodo({
    feature_node_id: importSources.id,
    content: 'Linear importer via GraphQL API',
    file_path: 'src/cli/import/linear.ts',
    created_by: 'ai',
  });
  createTodo({
    feature_node_id: importSources.id,
    content: 'Markdown TODO importer (## headings → features, - [ ] → tasks)',
    file_path: 'src/cli/import/markdown.ts',
    created_by: 'ai',
  });

  // v3 > Export / reporting
  const exportReport = createNode({
    project_id: project.id,
    parent_id: platform.id,
    kind: 'feature',
    title: 'Export & weekly report generation',
    description: '`compass export --format markdown` generates a weekly status report: features completed, AI usage stats, cross-tool breakdown. Useful for team standups or investor updates.',
    source: 'user',
    phase: 'v3',
  });

  // v3 > Multi-device sync
  const multiDevice = createNode({
    project_id: project.id,
    parent_id: platform.id,
    kind: 'feature',
    title: 'Multi-device sync (cloud layer)',
    description: 'SQLite → CRDT or last-write-wins sync via cloud endpoint. Enables laptop + desktop + phone dashboard. Pro tier feature ($9/mo).',
    source: 'user',
    phase: 'v3',
  });

  // v3 > Client capability declarations
  const clientCaps = createNode({
    project_id: project.id,
    parent_id: platform.id,
    kind: 'feature',
    title: 'Client capability declarations',
    description: 'Each AI client declares what it can do (bash, file edit, search). Compass suggests the best tool for a task based on registered capabilities. "This shell-heavy task → use Claude Code."',
    source: 'user',
    phase: 'v3',
  });

  // v3 > Team collaboration
  const teamCollab = createNode({
    project_id: project.id,
    parent_id: platform.id,
    kind: 'feature',
    title: 'Team collaboration — shared project state',
    description: 'Multiple developers share Compass state for the same project. Each person\'s AI runs are visible to the team. Shared test queue. Useful for AI-augmented dev teams.',
    source: 'user',
    phase: 'v3',
  });

  // ── Summary ──────────────────────────────────────────────────────
  const finalNodes = listProjectNodes(project.id);
  const v1Count = finalNodes.filter((n) => n.phase === 'v1' && n.kind !== 'module').length;
  const v2Count = finalNodes.filter((n) => n.phase === 'v2' && n.kind !== 'module').length;
  const v3Count = finalNodes.filter((n) => n.phase === 'v3' && n.kind !== 'module').length;

  console.log();
  console.log('[roadmap] ✅ Roadmap seeded');
  console.log(`[roadmap]   v1 features: ${v1Count} (current sprint)`);
  console.log(`[roadmap]   v2 features: ${v2Count} (setup friction + MCP enhancements)`);
  console.log(`[roadmap]   v3 features: ${v3Count} (platform & ecosystem)`);
  console.log(`[roadmap]   Dashboard: http://localhost:18737`);
  console.log(`[roadmap]   Switch phases in the dashboard to see each roadmap`);

  closeDb();
}

main().catch((err) => {
  console.error('[roadmap] fatal:', err);
  process.exit(1);
});
