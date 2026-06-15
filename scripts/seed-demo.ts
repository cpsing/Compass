import { mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../src/db/migrate.ts';
import { ensureProject } from '../src/db/projects.ts';
import { createNode, getNode } from '../src/db/feature-nodes.ts';
import {
  updateStatus,
  touchByClient,
  setActiveAiRun,
  setUserActionRequired,
  setTestSteps,
} from '../src/db/feature-node-mutations.ts';
import { createRun } from '../src/db/ai-runs.ts';
import { createTodo } from '../src/db/code-todos.ts';
import { openDb, closeDb } from '../src/db/connection.ts';

const DATA_DIR = process.env.COMPASS_DATA_DIR ?? join(homedir(), '.compass-demo');

async function main(): Promise<void> {
  process.env.COMPASS_DATA_DIR = DATA_DIR;

  if (process.argv.includes('--reset')) {
    rmSync(DATA_DIR, { recursive: true, force: true });
    console.log(`[seed] cleared ${DATA_DIR}`);
  }
  mkdirSync(DATA_DIR, { recursive: true });
  migrate();

  const projectRoot = join(homedir(), 'demo-saas');
  mkdirSync(projectRoot, { recursive: true });
  const project = ensureProject(projectRoot, 'demo-saas');

  // Mark v2 known so deferred features can exist
  const db = openDb();
  db.prepare("UPDATE projects SET known_phases = '[\"v1\",\"v2\"]' WHERE id = ?").run(project.id);
  closeDb();

  console.log(`[seed] project ${project.id} at ${projectRoot}`);

  const auth = createNode({
    project_id: project.id,
    kind: 'module',
    title: 'Auth',
    source: 'user',
    description: 'Authentication, registration, password flows.',
  });
  const billing = createNode({
    project_id: project.id,
    kind: 'module',
    title: 'Billing',
    source: 'user',
  });

  // Auth > Email login (verified)
  const emailLogin = createNode({
    project_id: project.id,
    parent_id: auth.id,
    kind: 'feature',
    title: 'Email login',
    description: 'POST /auth/login + JWT issuance + middleware.',
    source: 'user',
  });
  updateStatus({ id: emailLogin.id, status: 'verified', caller: 'user' });
  setTestSteps(
    emailLogin.id,
    '- POST /auth/register with new email\n- POST /auth/login, expect JWT\n- GET /me with token, expect 200',
  );
  touchByClient(emailLogin.id, 'cursor');
  const elRun1 = createRun({
    feature_node_id: emailLogin.id,
    client_type: 'cursor',
    intent: 'implement',
    run_status: 'completed',
    origin: 'mcp',
    user_prompt_summary: 'Build email login backend',
    plan: '1. users table\n2. POST /register\n3. POST /login\n4. JWT middleware',
    summary: 'Implemented register, login, JWT middleware. All passing.',
    files_touched: ['src/auth/login.ts', 'src/auth/register.ts', 'src/middleware/jwt.ts'],
    commit_sha: 'abc1234',
    started_at: Date.now() - 86_400_000 * 3,
    completed_at: Date.now() - 86_400_000 * 3 + 1_800_000,
  });
  void elRun1;

  // Auth > Password reset (needs_user_action)
  const pwReset = createNode({
    project_id: project.id,
    parent_id: auth.id,
    kind: 'feature',
    title: 'Password reset',
    description: 'Forgot password flow with email link + token.',
    source: 'user',
  });
  updateStatus({ id: pwReset.id, status: 'needs_user_action', caller: 'ai' });
  setUserActionRequired(
    pwReset.id,
    `- Sign up for a SendGrid account at https://sendgrid.com\n- Create an API key with "Mail Send" scope\n- Set SENDGRID_API_KEY in .env\n- Add FROM_EMAIL=noreply@yourdomain.com`,
  );
  setTestSteps(
    pwReset.id,
    '- POST /auth/forgot {email}\n- Check email inbox for reset link\n- Click link, expect /reset page\n- Submit new password, expect login works',
  );
  touchByClient(pwReset.id, 'claude_code');
  const prRun = createRun({
    feature_node_id: pwReset.id,
    client_type: 'claude_code',
    intent: 'implement',
    run_status: 'completed',
    origin: 'mcp',
    user_prompt_summary: 'Add forgot password endpoint',
    plan: '1. Add /auth/forgot route\n2. Generate reset token\n3. Send email via SendGrid stub\n4. Add /auth/reset to consume token',
    summary:
      'Implemented forgot + reset endpoints. Email sending stubbed pending API key.',
    files_touched: ['src/auth/forgot.ts', 'src/auth/reset.ts', 'src/services/email.ts'],
    commit_sha: 'def5678',
    started_at: Date.now() - 86_400_000 * 1,
    completed_at: Date.now() - 86_400_000 * 1 + 2_400_000,
  });
  createTodo({
    feature_node_id: pwReset.id,
    ai_run_id: prRun.id,
    content: 'Replace email stub once SendGrid is configured',
    file_path: 'src/services/email.ts',
    line_number: 18,
    created_by: 'ai',
  });
  createTodo({
    feature_node_id: pwReset.id,
    ai_run_id: prRun.id,
    content: 'Add rate limit to /auth/forgot (currently unbounded)',
    file_path: 'src/auth/forgot.ts',
    line_number: 42,
    created_by: 'ai',
  });

  // Auth > OAuth (planned, deferred to v2)
  const oauth = createNode({
    project_id: project.id,
    parent_id: auth.id,
    kind: 'feature',
    title: 'OAuth (Google + GitHub)',
    source: 'user',
    phase: 'v2',
  });
  void oauth;

  // Billing > Stripe checkout (in_progress)
  const stripe = createNode({
    project_id: project.id,
    parent_id: billing.id,
    kind: 'feature',
    title: 'Stripe checkout',
    description: 'One-time payment checkout flow.',
    source: 'user',
  });
  updateStatus({ id: stripe.id, status: 'in_progress', caller: 'ai' });
  const stripeRun = createRun({
    feature_node_id: stripe.id,
    client_type: 'cursor',
    intent: 'implement',
    run_status: 'running',
    origin: 'mcp',
    user_prompt_summary: 'Add Stripe checkout endpoint',
    plan: '1. Add /api/checkout\n2. Create Stripe session\n3. Handle webhook',
    started_at: Date.now() - 600_000, // 10 min ago, still active
  });
  setActiveAiRun(stripe.id, stripeRun.id);
  touchByClient(stripe.id, 'cursor');

  const stripeWebhook = createNode({
    project_id: project.id,
    parent_id: stripe.id,
    kind: 'task',
    title: 'Webhook signature verification',
    source: 'ai',
  });
  updateStatus({ id: stripeWebhook.id, status: 'ai_completed', caller: 'ai' });
  touchByClient(stripeWebhook.id, 'cursor');

  // Billing > Invoices (ai_completed, awaiting test)
  const invoices = createNode({
    project_id: project.id,
    parent_id: billing.id,
    kind: 'feature',
    title: 'Invoice list page',
    description: 'Authenticated user can view past charges.',
    source: 'user',
  });
  updateStatus({ id: invoices.id, status: 'ai_completed', caller: 'ai' });
  setTestSteps(
    invoices.id,
    '- Log in as a user with 2 past charges\n- Open /billing/invoices\n- Expect 2 rows with date + amount + status',
  );
  touchByClient(invoices.id, 'claude_desktop');
  createRun({
    feature_node_id: invoices.id,
    client_type: 'claude_desktop',
    intent: 'implement',
    run_status: 'completed',
    origin: 'reconciled', // demo the reconciled badge
    summary: 'Inferred from commit + file changes',
    files_touched: ['app/billing/invoices/page.tsx'],
    commit_sha: 'fed9abc',
    started_at: Date.now() - 7_200_000,
    completed_at: Date.now() - 6_900_000,
  });

  console.log('[seed] done.');
  console.log(`[seed] open http://localhost:3737 (COMPASS_DATA_DIR=${DATA_DIR})`);
  console.log(`       project id: ${project.id}`);
  closeDb();
}

main().catch((err) => {
  console.error('[seed] fatal:', err);
  process.exit(1);
});
