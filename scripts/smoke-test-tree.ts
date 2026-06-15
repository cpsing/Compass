import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../src/db/migrate.ts";
import { ensureProject } from "../src/db/projects.ts";
import {
  createNode,
  getNode,
  getChildren,
  listSubtree,
  listProjectNodes,
  deleteNode,
} from "../src/db/feature-nodes.ts";
import {
  updateStatus,
  setActiveAiRun,
  touchByClient,
  setPhase,
  setUserActionRequired,
  TrustBoundaryError,
} from "../src/db/feature-node-mutations.ts";
import { closeDb } from "../src/db/connection.ts";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: Assertion[] = [];
function expect(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  const tag = ok ? "OK" : "FAIL";
  console.log(`  [${tag}] ${name}${detail ? "  — " + detail : ""}`);
}

function main(): void {
  const sandbox = mkdtempSync(join(tmpdir(), "compass-tree-"));
  process.env.COMPASS_DATA_DIR = join(sandbox, ".compass");
  console.log(`[tree] sandbox=${sandbox}`);

  try {
    migrate();
    const project = ensureProject(sandbox, "tree-test");
    console.log(`[tree] project=${project.id} phase=${project.active_phase}\n`);

    console.log("── tree construction");
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
    const taskA = createNode({
      project_id: project.id,
      parent_id: emailLogin.id,
      kind: "task",
      title: "POST /auth/login endpoint",
      source: "ai",
    });
    const taskB = createNode({
      project_id: project.id,
      parent_id: emailLogin.id,
      kind: "task",
      title: "JWT middleware",
      source: "ai",
    });

    expect("module depth=0", authModule.depth === 0);
    expect("feature depth=1", emailLogin.depth === 1);
    expect("task depth=2", taskA.depth === 2);
    expect(
      "feature path = module.feature",
      emailLogin.path === `${authModule.id}.${emailLogin.id}`,
    );
    expect(
      "task path = module.feature.task",
      taskA.path === `${authModule.id}.${emailLogin.id}.${taskA.id}`,
    );
    expect(
      "task inherits phase from parent feature",
      taskA.phase === "v1" && taskA.phase === emailLogin.phase,
    );

    console.log("\n── depth limit enforcement");
    const deepTask = createNode({
      project_id: project.id,
      parent_id: taskA.id,
      kind: "task",
      title: "depth 3 task (ok)",
      source: "ai",
    });
    expect("depth 3 allowed", deepTask.depth === 3);

    let depthErr: unknown = null;
    try {
      createNode({
        project_id: project.id,
        parent_id: deepTask.id,
        kind: "task",
        title: "depth 4 must fail",
        source: "ai",
      });
    } catch (e) {
      depthErr = e;
    }
    expect(
      "depth 4 rejected",
      depthErr instanceof Error && depthErr.message.includes("max depth"),
    );

    console.log("\n── listSubtree");
    const subtree = listSubtree(authModule.id);
    expect(
      "subtree includes module + feature + 2 tasks + 1 sub-task = 5",
      subtree.length === 5,
      `got ${subtree.length}`,
    );
    expect(
      "subtree ordered by path",
      subtree[0]!.id === authModule.id && subtree[1]!.id === emailLogin.id,
    );

    console.log("\n── listProjectNodes filters");
    const allNodes = listProjectNodes(project.id);
    expect("all nodes = 5", allNodes.length === 5);

    const tasks = listProjectNodes(project.id, { kind: "task" });
    expect("task kind filter = 3", tasks.length === 3, `got ${tasks.length}`);

    const planned = listProjectNodes(project.id, { status: "planned" });
    expect("all default to planned", planned.length === 5);

    const shallow = listProjectNodes(project.id, { max_depth: 1 });
    expect("max_depth=1 returns module+feature only", shallow.length === 2);

    console.log("\n── status transitions");
    updateStatus({ id: emailLogin.id, status: "in_progress", caller: "ai" });
    expect(
      "AI sets in_progress",
      getNode(emailLogin.id)!.status === "in_progress",
    );

    updateStatus({ id: emailLogin.id, status: "ai_completed", caller: "ai" });
    expect(
      "AI sets ai_completed",
      getNode(emailLogin.id)!.status === "ai_completed",
    );

    let trustErr: unknown = null;
    try {
      updateStatus({ id: emailLogin.id, status: "verified", caller: "ai" });
    } catch (e) {
      trustErr = e;
    }
    expect("AI blocked from verified", trustErr instanceof TrustBoundaryError);

    updateStatus({ id: emailLogin.id, status: "verified", caller: "user" });
    expect("user sets verified", getNode(emailLogin.id)!.status === "verified");

    console.log("\n── needs_user_action with required text");
    updateStatus({ id: taskA.id, status: "needs_user_action", caller: "ai" });
    setUserActionRequired(
      taskA.id,
      "- Sign up for SendGrid\n- Set SENDGRID_API_KEY",
    );
    const tA = getNode(taskA.id)!;
    expect(
      "needs_user_action + payload",
      tA.status === "needs_user_action" &&
        tA.user_action_required!.includes("SENDGRID"),
    );

    console.log("\n── active_ai_run optimistic lock");
    const lock1 = setActiveAiRun(emailLogin.id, "run-A");
    expect("first lock acquires", lock1);

    const lock2 = setActiveAiRun(emailLogin.id, "run-B");
    expect("conflicting lock rejected", !lock2);

    const release = setActiveAiRun(emailLogin.id, null);
    expect("release succeeds", release);

    const lock3 = setActiveAiRun(emailLogin.id, "run-C");
    expect("re-acquire after release", lock3);

    console.log("\n── client touch + participation");
    touchByClient(emailLogin.id, "cursor");
    touchByClient(emailLogin.id, "cursor");
    touchByClient(emailLogin.id, "claude_code");
    const touched = getNode(emailLogin.id)!;
    const parts = JSON.parse(touched.client_participation) as Record<
      string,
      number
    >;
    expect(
      "last_client = claude_code",
      touched.last_client_touched === "claude_code",
    );
    expect(
      "participation cursor=2 claude_code=1",
      parts.cursor === 2 && parts.claude_code === 1,
      JSON.stringify(parts),
    );

    console.log("\n── phase + defer");
    setPhase(taskB.id, "v2");
    expect("phase moved to v2", getNode(taskB.id)!.phase === "v2");
    const v1Tasks = listProjectNodes(project.id, { kind: "task", phase: "v1" });
    const v2Tasks = listProjectNodes(project.id, { kind: "task", phase: "v2" });
    expect(
      "phase filter splits tasks",
      v1Tasks.length === 2 && v2Tasks.length === 1,
      `v1=${v1Tasks.length} v2=${v2Tasks.length}`,
    );

    console.log("\n── phase filter with ancestors (tree view semantics)");
    // taskB (v2) is under emailLogin (v1) which is under authModule (v1).
    // With ancestor inclusion: v2 view should bring authModule + emailLogin
    // along as containers even though they themselves are in v1.
    const v2WithAncestors = listProjectNodes(project.id, {
      phase: "v2",
      include_phase_ancestors: true,
    });
    expect(
      "v2 view includes ancestors of taskB",
      v2WithAncestors.length === 3 &&
        v2WithAncestors.some((n) => n.id === authModule.id) &&
        v2WithAncestors.some((n) => n.id === emailLogin.id) &&
        v2WithAncestors.some((n) => n.id === taskB.id),
      `got ids: ${v2WithAncestors.map((n) => n.title).join(", ")}`,
    );
    // Without include_phase_ancestors: only the v2 node itself
    const v2Strict = listProjectNodes(project.id, { phase: "v2" });
    expect(
      "v2 strict view returns only taskB",
      v2Strict.length === 1 && v2Strict[0]!.id === taskB.id,
      `got ${v2Strict.length}`,
    );
    // v1 view with ancestors: includes module + feature + remaining 2 v1 tasks
    const v1WithAncestors = listProjectNodes(project.id, {
      phase: "v1",
      include_phase_ancestors: true,
    });
    expect(
      "v1 view does not include taskB",
      v1WithAncestors.every((n) => n.id !== taskB.id),
      `v1 ids: ${v1WithAncestors.map((n) => n.title).join(", ")}`,
    );

    console.log("\n── cascade delete");
    deleteNode(emailLogin.id);
    const afterDelete = listProjectNodes(project.id);
    expect(
      "feature delete cascades children",
      afterDelete.length === 1,
      `remaining=${afterDelete.length}`,
    );
    expect("module survives", afterDelete[0]!.id === authModule.id);

    const failed = results.filter((r) => !r.ok);
    console.log(
      `\n[tree] ${results.length - failed.length}/${results.length} passed`,
    );
    if (failed.length > 0) {
      console.error("[tree] FAIL");
      process.exitCode = 1;
    } else {
      console.log("[tree] PASS");
    }
  } finally {
    closeDb();
    rmSync(sandbox, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error("[tree] fatal:", err);
  process.exit(1);
}
