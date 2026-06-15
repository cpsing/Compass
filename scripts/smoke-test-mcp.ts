import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface ToolCallResult {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

class McpClient {
  private proc: ChildProcessWithoutNullStreams;
  private buf = "";
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }
  >();

  constructor(env: Record<string, string>) {
    const tsx = resolve("node_modules/.bin/tsx");
    const entry = resolve("src/mcp/server.ts");
    this.proc = spawn(tsx, [entry], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    this.proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(`[mcp-stderr] ${chunk}`);
    });
    this.proc.on("error", (err) => {
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });
  }

  private onData(chunk: Buffer): void {
    this.buf += chunk.toString("utf8");
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        if (typeof msg.id === "number") {
          const handler = this.pending.get(msg.id);
          if (handler) {
            this.pending.delete(msg.id);
            handler.resolve(msg);
          }
        }
      } catch (err) {
        process.stderr.write(`[mcp-parse-error] ${line}\n`);
      }
    }
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const msg = { jsonrpc: "2.0" as const, id, method, params };
    return new Promise((resolveFn, rejectFn) => {
      this.pending.set(id, { resolve: resolveFn, reject: rejectFn });
      this.proc.stdin.write(JSON.stringify(msg) + "\n");
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rejectFn(new Error(`request timeout: ${method}`));
        }
      }, 10000);
    });
  }

  async initialize(): Promise<void> {
    await this.send("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "smoke-mcp-client", version: "0.0.1" },
    });
    this.proc.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }) + "\n",
    );
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    const resp = await this.send("tools/call", { name, arguments: args });
    if (resp.error) {
      throw new Error(`${name} → JSON-RPC error: ${resp.error.message}`);
    }
    return resp.result as unknown as ToolCallResult;
  }

  async listTools(): Promise<Array<{ name: string }>> {
    const resp = await this.send("tools/list", {});
    return (resp.result?.["tools"] as Array<{ name: string }>) ?? [];
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}
const checks: Check[] = [];
function assert(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
  console.log(
    `  [${ok ? "OK" : "FAIL"}] ${name}${detail ? "  — " + detail : ""}`,
  );
}

function parseStructured<T = Record<string, unknown>>(res: ToolCallResult): T {
  const sc = res.structuredContent;
  if (sc) return sc as T;
  const text = res.content[0]?.text ?? "{}";
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  const sandbox = mkdtempSync(join(tmpdir(), "compass-mcp-"));
  const projectRoot = join(sandbox, "project");
  const env = {
    COMPASS_DATA_DIR: join(sandbox, ".compass"),
    COMPASS_PROJECT_ROOT: projectRoot,
    COMPASS_CLIENT_TYPE: "smoke_test",
  };
  console.log(`[mcp] sandbox=${sandbox}`);

  // Create project root dir so realpathSync resolves
  const { mkdirSync } = await import("node:fs");
  mkdirSync(projectRoot, { recursive: true });

  const client = new McpClient(env);

  try {
    await client.initialize();

    const tools = await client.listTools();
    assert(
      "all 13 tools registered",
      tools.length === 13,
      `got ${tools.length}: ${tools.map((t) => t.name).join(", ")}`,
    );

    // === Pre-populate via direct DB calls (module + feature must be user-created) ===
    process.env.COMPASS_DATA_DIR = env.COMPASS_DATA_DIR;
    const { migrate } = await import("../src/db/migrate.ts");
    const { ensureProject } = await import("../src/db/projects.ts");
    const { createNode } = await import("../src/db/feature-nodes.ts");
    const { closeDb } = await import("../src/db/connection.ts");
    migrate();
    const project = ensureProject(projectRoot);
    const authModule = createNode({
      project_id: project.id,
      kind: "module",
      title: "Auth",
      source: "user",
    });
    const emailLogin = createNode({
      project_id: project.id,
      parent_id: authModule.id,
      kind: "feature",
      title: "Email login",
      source: "user",
    });
    const pwReset = createNode({
      project_id: project.id,
      parent_id: authModule.id,
      kind: "feature",
      title: "Password reset",
      source: "user",
    });
    closeDb();

    console.log("\n── compass_list_features (default = active phase)");
    const list1 = parseStructured<{
      summary: { total: number };
      nodes: unknown[];
    }>(await client.callTool("compass_list_features", {}));
    assert(
      "lists 3 nodes in v1",
      list1.summary.total === 3,
      `got total=${list1.summary.total}`,
    );

    console.log("\n── compass_create_feature_node (AI task under feature)");
    const created = parseStructured<{
      node: { id: string; kind: string; depth: number };
    }>(
      await client.callTool("compass_create_feature_node", {
        parent_id: emailLogin.id,
        title: "POST /auth/login endpoint",
      }),
    );
    assert("task created with kind=task", created.node.kind === "task");
    assert("task depth=2", created.node.depth === 2);

    console.log("\n── trust: AI cannot create task under module");
    const createUnderModule = await client.callTool(
      "compass_create_feature_node",
      {
        parent_id: authModule.id,
        title: "illegal direct task",
      },
    );
    assert(
      "reject task under module",
      createUnderModule.isError === true,
      String(createUnderModule.content[0]?.text).slice(0, 80),
    );

    console.log("\n── compass_start_ai_run");
    const startRes = parseStructured<{ ai_run_id: string; status: string }>(
      await client.callTool("compass_start_ai_run", {
        feature_node_id: emailLogin.id,
        intent: "implement",
        user_prompt_summary: "build email login backend",
        plan: "1. user table\n2. POST /register\n3. POST /login",
      }),
    );
    assert(
      "run created + status=in_progress",
      startRes.status === "in_progress",
    );

    console.log("\n── compass_start_ai_run conflict on second start");
    const conflict = parseStructured<{ conflict?: boolean }>(
      await client.callTool("compass_start_ai_run", {
        feature_node_id: emailLogin.id,
        intent: "fix",
        user_prompt_summary: "rival session",
      }),
    );
    assert(
      "returns conflict when active run exists",
      conflict.conflict === true,
    );

    console.log("\n── compass_add_code_todo");
    const todoRes = parseStructured<{ id: string }>(
      await client.callTool("compass_add_code_todo", {
        feature_node_id: emailLogin.id,
        ai_run_id: startRes.ai_run_id,
        content: "replace password hash placeholder with bcrypt",
        file_path: "src/auth/register.ts",
        line_number: 42,
      }),
    );
    assert("todo created", typeof todoRes.id === "string");

    console.log("\n── compass_list_todos shows open todo");
    const todosList = parseStructured<{ count: number }>(
      await client.callTool("compass_list_todos", {}),
    );
    assert("one open todo listed", todosList.count === 1);

    console.log("\n── compass_log_test_steps");
    await client.callTool("compass_log_test_steps", {
      feature_node_id: emailLogin.id,
      test_steps: "- POST /auth/register with email\n- Verify token in DB",
    });
    assert("log_test_steps ok", true);

    console.log("\n── compass_finish_ai_run with needs_user_action");
    const finishRes = parseStructured<{ feature_status: string }>(
      await client.callTool("compass_finish_ai_run", {
        ai_run_id: startRes.ai_run_id,
        run_status: "completed",
        next_status: "needs_user_action",
        user_action_required:
          "- Sign up for SendGrid\n- Add SENDGRID_API_KEY to .env",
        summary: "implemented login + register, email sending stubbed",
        commit_sha: "abc123",
        files_touched: ["src/auth/login.ts", "src/auth/register.ts"],
      }),
    );
    assert(
      "feature_status = needs_user_action",
      finishRes.feature_status === "needs_user_action",
      finishRes.feature_status,
    );

    console.log(
      "\n── trust: finish requires user_action when needs_user_action",
    );
    const finishBad = await client.callTool("compass_finish_ai_run", {
      ai_run_id: startRes.ai_run_id,
      run_status: "completed",
      next_status: "needs_user_action",
      summary: "missing action text",
    });
    assert(
      "reject empty user_action_required",
      finishBad.isError === true,
      String(finishBad.content[0]?.text).slice(0, 80),
    );

    console.log("\n── compass_update_feature_status (AI restricted)");
    const updateBad = await client.callTool("compass_update_feature_status", {
      feature_node_id: emailLogin.id,
      status: "verified",
    });
    // zod rejects at schema level before handler — JSON-RPC returns error
    const updateBadIsError =
      updateBad.isError === true ||
      /verified/.test(updateBad.content[0]?.text ?? "");
    assert(
      "AI blocked from verified at schema",
      updateBadIsError,
      String(updateBad.content[0]?.text ?? "").slice(0, 80),
    );

    console.log("\n── compass_defer_feature");
    // pwReset is at v1; we need to add v2 to known_phases first via DB
    process.env.COMPASS_DATA_DIR = env.COMPASS_DATA_DIR;
    const { openDb, closeDb: closeDb2 } =
      await import("../src/db/connection.ts");
    const db2 = openDb();
    db2
      .prepare("UPDATE projects SET known_phases = ? WHERE id = ?")
      .run(JSON.stringify(["v1", "v2"]), project.id);
    closeDb2();

    const deferRes = parseStructured<{
      to_phase: string;
      descendants_moved: number;
    }>(
      await client.callTool("compass_defer_feature", {
        feature_node_id: pwReset.id,
        target_phase: "v2",
        reason: "out of scope for v1",
      }),
    );
    assert("deferred to v2", deferRes.to_phase === "v2");

    console.log("\n── trust: cannot defer to unknown phase");
    const deferBad = await client.callTool("compass_defer_feature", {
      feature_node_id: emailLogin.id,
      target_phase: "experimental-z",
      reason: "try invalid",
    });
    assert(
      "reject unknown target_phase",
      deferBad.isError === true,
      String(deferBad.content[0]?.text).slice(0, 80),
    );

    console.log("\n── trust: cannot defer node already in non-active phase");
    const deferReverse = await client.callTool("compass_defer_feature", {
      feature_node_id: pwReset.id,
      target_phase: "v1",
      reason: "try to pull back",
    });
    assert(
      "reject pulling back to active phase",
      deferReverse.isError === true,
      String(deferReverse.content[0]?.text).slice(0, 80),
    );

    console.log("\n── compass_list_subtree");
    const subtree = parseStructured<{ count: number; nodes: unknown[] }>(
      await client.callTool("compass_list_subtree", { node_id: authModule.id }),
    );
    // authModule + emailLogin + 1 task = 3 nodes (pwReset moved to v2 still in subtree)
    assert(
      "subtree returns multiple nodes",
      subtree.count >= 3,
      `count=${subtree.count}`,
    );

    console.log("\n── compass_get_feature");
    const detail = parseStructured<{
      node: { id: string; status: string };
      recent_runs: unknown[];
      open_todos: unknown[];
    }>(
      await client.callTool("compass_get_feature", {
        feature_node_id: emailLogin.id,
      }),
    );
    assert(
      "feature detail has the run history",
      detail.recent_runs.length >= 1 && detail.open_todos.length === 1,
    );

    // === v0.3.1 differentiation tools ===

    console.log("\n── compass_generate_handoff_brief");
    const briefRes = await client.callTool("compass_generate_handoff_brief", {
      feature_node_id: emailLogin.id,
    });
    const briefMd = briefRes.content[0]?.text ?? "";
    const briefStructured =
      (briefRes.structuredContent as {
        markdown?: string;
        open_todo_count?: number;
      }) ?? {};
    assert(
      "brief returns non-trivial markdown",
      briefMd.length > 200,
      `len=${briefMd.length}`,
    );
    assert("brief has Handoff title", briefMd.startsWith("# Handoff Brief"));
    assert(
      "brief includes parent feature section",
      briefMd.includes("## Parent feature"),
    );
    assert(
      "brief includes recent AIRuns section",
      briefMd.includes("## Recent AIRuns"),
    );
    assert(
      "brief shows needs_user_action prominently",
      briefMd.includes("Pending user action") &&
        briefMd.includes("SENDGRID_API_KEY"),
    );
    assert(
      "brief includes open todo line",
      briefMd.includes("bcrypt") && briefMd.includes("src/auth/register.ts"),
    );
    assert(
      "brief has Suggested next step",
      briefMd.includes("## Suggested next step"),
    );
    assert(
      "structured payload echoes todo count",
      briefStructured.open_todo_count === 1,
      String(briefStructured.open_todo_count),
    );

    // Simulate a Claude Code session running on Password reset (different client)
    process.env.COMPASS_DATA_DIR = env.COMPASS_DATA_DIR;
    const { createRun } = await import("../src/db/ai-runs.ts");
    const { touchByClient } =
      await import("../src/db/feature-node-mutations.ts");
    const { openDb: openDbCC, closeDb: closeDbCC } =
      await import("../src/db/connection.ts");
    const dbCC = openDbCC();
    createRun({
      feature_node_id: pwReset.id,
      client_type: "claude_code",
      intent: "implement",
      run_status: "completed",
      origin: "mcp",
      summary: "scaffolded forgot endpoint",
      files_touched: ["src/auth/forgot.ts"],
      completed_at: Date.now(),
    });
    touchByClient(pwReset.id, "claude_code");
    closeDbCC();
    void dbCC;

    console.log("\n── compass_get_client_activity");
    const activityRes = parseStructured<{
      clients: Array<{
        client_type: string;
        run_count: number;
        completed: number;
        files_touched_count: number;
        top_features: Array<{ title: string }>;
      }>;
    }>(await client.callTool("compass_get_client_activity", {}));
    assert(
      "activity returns ≥ 2 clients (smoke_test + claude_code)",
      activityRes.clients.length >= 2,
      `count=${activityRes.clients.length}`,
    );
    const smokeStats = activityRes.clients.find(
      (c) => c.client_type === "smoke_test",
    );
    const ccStats = activityRes.clients.find(
      (c) => c.client_type === "claude_code",
    );
    assert(
      "smoke_test client has run + files",
      !!smokeStats &&
        smokeStats.run_count >= 1 &&
        smokeStats.files_touched_count >= 2,
      smokeStats ? JSON.stringify(smokeStats) : "missing",
    );
    assert(
      "claude_code client present with top feature",
      !!ccStats &&
        ccStats.top_features.some((tf) => tf.title === "Password reset"),
    );

    console.log("\n── compass_get_client_activity filtered by client");
    const filteredRes = parseStructured<{
      clients: Array<{ client_type: string }>;
    }>(
      await client.callTool("compass_get_client_activity", {
        client_type: "claude_code",
      }),
    );
    assert(
      "filter narrows to one client",
      filteredRes.clients.length === 1 &&
        filteredRes.clients[0]?.client_type === "claude_code",
    );

    console.log("\n── verify activity_events recorded each tool call");
    process.env.COMPASS_DATA_DIR = env.COMPASS_DATA_DIR;
    const { openDb: openDb3, closeDb: closeDb3 } =
      await import("../src/db/connection.ts");
    const db3 = openDb3();
    const row = db3
      .prepare(
        "SELECT COUNT(*) AS n FROM activity_events WHERE source = 'mcp_call'",
      )
      .get() as { n: number };
    closeDb3();
    assert("mcp_call events written", row.n >= 11, `count=${row.n}`);

    const failed = checks.filter((c) => !c.ok);
    console.log(
      `\n[mcp] ${checks.length - failed.length}/${checks.length} checks passed`,
    );
    if (failed.length > 0) {
      console.error("[mcp] FAIL");
      process.exitCode = 1;
    } else {
      console.log("[mcp] PASS");
    }
  } finally {
    client.close();
    await sleep(100);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[mcp] fatal:", err);
  process.exit(1);
});
