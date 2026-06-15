import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../src/db/migrate.ts";
import { ensureProject } from "../src/db/projects.ts";
import { createNode, getNode } from "../src/db/feature-nodes.ts";
import { recordTestResult } from "../src/services/test-result.ts";
import {
  addPhase,
  renamePhase,
  deletePhase,
  setActivePhase,
} from "../src/services/phases.ts";
import { renameProject, deleteProject } from "../src/services/project-admin.ts";
import { hardDeleteNode } from "../src/services/node-admin.ts";
import { updateNode } from "../src/db/feature-node-mutations.ts";
import { createRun } from "../src/db/ai-runs.ts";
import { listTestRunsForNode } from "../src/db/test-runs.ts";
import { insertEvent } from "../src/db/events.ts";
import { createTodo } from "../src/db/code-todos.ts";
import { openDb, closeDb } from "../src/db/connection.ts";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}
const results: Check[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  console.log(
    `  [${ok ? "OK" : "FAIL"}] ${name}${detail ? "  — " + detail : ""}`,
  );
}

function main(): void {
  const sandbox = mkdtempSync(join(tmpdir(), "compass-admin-"));
  process.env.COMPASS_DATA_DIR = join(sandbox, ".compass");
  console.log(`[admin] sandbox=${sandbox}`);

  try {
    migrate();
    const project = ensureProject(sandbox, "admin-test");

    // === Build a minimal tree ===
    const auth = createNode({
      project_id: project.id,
      kind: "module",
      title: "Auth",
      source: "user",
    });
    const emailLogin = createNode({
      project_id: project.id,
      parent_id: auth.id,
      kind: "feature",
      title: "Email login",
      source: "user",
    });
    const pwReset = createNode({
      project_id: project.id,
      parent_id: auth.id,
      kind: "feature",
      title: "Password reset",
      source: "user",
    });
    // Existing AI run on emailLogin to link test_run to
    const aiRun = createRun({
      feature_node_id: emailLogin.id,
      client_type: "cursor",
      intent: "implement",
      run_status: "completed",
      origin: "mcp",
      summary: "done",
    });

    console.log("\n── updateNode (title + description)");
    updateNode({
      id: emailLogin.id,
      title: "Email login (renamed)",
      description: "Updated description for smoke",
    });
    const editedNode = getNode(emailLogin.id)!;
    check("title updated", editedNode.title === "Email login (renamed)");
    check(
      "description updated",
      editedNode.description === "Updated description for smoke",
    );

    let emptyTitleErr: unknown = null;
    try {
      updateNode({ id: emailLogin.id, title: "   " });
    } catch (e) {
      emptyTitleErr = e;
    }
    check(
      "empty title rejected",
      emptyTitleErr instanceof Error &&
        /cannot be empty/.test(emptyTitleErr.message),
    );

    // Restore for downstream assertions that expect "Email login"
    updateNode({ id: emailLogin.id, title: "Email login" });

    console.log("\n── recordTestResult (passed)");
    const passed = recordTestResult({
      feature_node_id: emailLogin.id,
      result: "passed",
      notes: "manual + browser smoke",
    });
    check("passed recorded", passed.ok, passed.error);
    check(
      "feature status now verified",
      getNode(emailLogin.id)?.status === "verified",
    );
    const passedRuns = listTestRunsForNode(emailLogin.id);
    check("1 test_run row", passedRuns.length === 1);
    check(
      "test_run linked to latest ai_run",
      passedRuns[0]?.ai_run_id === aiRun.id,
    );
    check("notes saved", passedRuns[0]?.notes === "manual + browser smoke");
    check(
      "last_tested_at populated",
      typeof getNode(emailLogin.id)?.last_tested_at === "number",
    );

    console.log("\n── recordTestResult (failed)");
    const failed = recordTestResult({
      feature_node_id: pwReset.id,
      result: "failed",
      notes: "reset link 404s",
    });
    check("failed recorded", failed.ok);
    check(
      "feature status now broken",
      getNode(pwReset.id)?.status === "broken",
    );
    check(
      "1 test_run row on pwReset",
      listTestRunsForNode(pwReset.id).length === 1,
    );

    console.log("\n── phase: add");
    const addV2 = addPhase(project.id, "v2");
    check("v2 added", addV2.ok && addV2.known_phases?.includes("v2") === true);

    const addDuplicate = addPhase(project.id, "v2");
    check(
      "duplicate add rejected",
      !addDuplicate.ok && /already exists/.test(addDuplicate.error ?? ""),
      addDuplicate.error,
    );

    const badName = addPhase(project.id, "v 3!");
    check(
      "invalid name rejected",
      !badName.ok && /letters/.test(badName.error ?? ""),
      badName.error,
    );

    console.log("\n── phase: rename (cascade to feature_nodes + active_phase)");
    // pwReset is at phase v1 initially; switch it to v2 to test rename cascade
    const db = openDb();
    db.prepare("UPDATE feature_nodes SET phase = 'v2' WHERE id = ?").run(
      pwReset.id,
    );
    const renamed = renamePhase(project.id, "v2", "beta");
    check("rename ok", renamed.ok, renamed.error);
    check(
      "known_phases reflects rename",
      renamed.known_phases?.includes("beta") === true &&
        renamed.known_phases?.includes("v2") === false,
    );
    check(
      "pwReset.phase cascaded to beta",
      getNode(pwReset.id)?.phase === "beta",
    );

    const renameToExisting = renamePhase(project.id, "beta", "v1");
    check(
      "rename to existing rejected",
      !renameToExisting.ok &&
        /already exists/.test(renameToExisting.error ?? ""),
    );

    console.log("\n── phase: delete");
    const delActive = deletePhase(project.id, "v1");
    check(
      "delete active phase rejected",
      !delActive.ok && /active/.test(delActive.error ?? ""),
      delActive.error,
    );

    const delUsed = deletePhase(project.id, "beta");
    check(
      "delete used phase rejected",
      !delUsed.ok && /move or archive/.test(delUsed.error ?? ""),
      delUsed.error,
    );

    // Move pwReset back to v1 so beta is empty, then delete beta
    db.prepare("UPDATE feature_nodes SET phase = 'v1' WHERE id = ?").run(
      pwReset.id,
    );
    const delBeta = deletePhase(project.id, "beta");
    check("delete empty phase ok", delBeta.ok, delBeta.error);
    check(
      "beta gone from known_phases",
      delBeta.known_phases?.includes("beta") === false,
    );

    console.log("\n── phase: setActive");
    addPhase(project.id, "v2");
    const switchActive = setActivePhase(project.id, "v2");
    check(
      "switch active ok",
      switchActive.ok && switchActive.active_phase === "v2",
    );

    const switchUnknown = setActivePhase(project.id, "experimental-z");
    check(
      "switch to unknown rejected",
      !switchUnknown.ok &&
        /not in known_phases/.test(switchUnknown.error ?? ""),
    );

    console.log(
      "\n── hardDeleteNode (subtree cascade + activity_events nullification)",
    );
    // Build an isolated sandbox subtree
    const sandboxModule = createNode({
      project_id: project.id,
      kind: "module",
      title: "Sandbox",
      source: "user",
    });
    const sandboxFeature = createNode({
      project_id: project.id,
      parent_id: sandboxModule.id,
      kind: "feature",
      title: "Throwaway feature",
      source: "user",
    });
    const sandboxTask = createNode({
      project_id: project.id,
      parent_id: sandboxFeature.id,
      kind: "task",
      title: "Throwaway task",
      source: "ai",
    });
    const sandboxRun = createRun({
      feature_node_id: sandboxFeature.id,
      client_type: "cursor",
      intent: "implement",
      run_status: "completed",
      origin: "mcp",
      summary: "sandbox run",
      files_touched: ["sandbox/a.ts"],
    });
    createTodo({
      feature_node_id: sandboxFeature.id,
      ai_run_id: sandboxRun.id,
      content: "sandbox todo",
      created_by: "ai",
    });
    recordTestResult({
      feature_node_id: sandboxFeature.id,
      result: "passed",
    });
    const sandboxEventId = insertEvent({
      project_id: project.id,
      source: "mcp_call",
      event_type: "tool_call",
      payload: {
        tool_name: "compass_start_ai_run",
        args: { feature_node_id: sandboxFeature.id },
        client_type: "cursor",
      },
    });
    // Manually link the event to the node + run so we can verify nullification
    db.prepare(
      `UPDATE activity_events SET feature_node_id = ?, ai_run_id = ?, reconciled = 1 WHERE id = ?`,
    ).run(sandboxFeature.id, sandboxRun.id, sandboxEventId);

    const wrongConfirmDel = hardDeleteNode(sandboxModule.id, "wrong-title");
    check(
      "hard delete with wrong confirmation rejected",
      !wrongConfirmDel.ok && /mismatch/.test(wrongConfirmDel.error ?? ""),
      wrongConfirmDel.error,
    );

    const hd = hardDeleteNode(sandboxModule.id, "Sandbox");
    check("hard delete ok", hd.ok, hd.error);
    check(
      "deleted 3 nodes (module + feature + task)",
      (hd.deleted?.nodes ?? 0) === 3,
      JSON.stringify(hd.deleted),
    );
    check("deleted 1 ai_run", (hd.deleted?.ai_runs ?? 0) === 1);
    check("deleted 1 code_todo", (hd.deleted?.code_todos ?? 0) === 1);
    check("deleted 1 test_run", (hd.deleted?.test_runs ?? 0) === 1);
    check(
      "1 activity_events FK ref nullified (feature_node_id only counted)",
      (hd.deleted?.activity_events_nullified ?? 0) >= 1,
      String(hd.deleted?.activity_events_nullified),
    );

    check("subtree nodes gone", getNode(sandboxModule.id) === null);
    check("sandbox feature gone", getNode(sandboxFeature.id) === null);
    check("sandbox task gone", getNode(sandboxTask.id) === null);

    // The activity_event survives but its FK refs are null
    const surviving = db
      .prepare(
        "SELECT feature_node_id, ai_run_id FROM activity_events WHERE id = ?",
      )
      .get(sandboxEventId) as
      | { feature_node_id: string | null; ai_run_id: string | null }
      | undefined;
    check(
      "event row preserved with NULL refs",
      surviving !== undefined &&
        surviving.feature_node_id === null &&
        surviving.ai_run_id === null,
      JSON.stringify(surviving),
    );

    console.log("\n── project: rename");
    const renameOk = renameProject(project.id, "admin-test-renamed");
    check("rename ok", renameOk.ok);
    const renameEmpty = renameProject(project.id, "   ");
    check(
      "empty name rejected",
      !renameEmpty.ok && /empty/.test(renameEmpty.error ?? ""),
    );

    console.log("\n── project: delete (confirmation)");
    const wrongConfirm = deleteProject(project.id, "wrong-name");
    check(
      "wrong confirmation rejected",
      !wrongConfirm.ok && /mismatch/.test(wrongConfirm.error ?? ""),
    );

    // Count rows before deletion
    const countNodes = db
      .prepare("SELECT COUNT(*) AS n FROM feature_nodes WHERE project_id = ?")
      .get(project.id) as { n: number };
    const countRuns = db
      .prepare(
        `SELECT COUNT(*) AS n FROM ai_runs
         WHERE feature_node_id IN (SELECT id FROM feature_nodes WHERE project_id = ?)`,
      )
      .get(project.id) as { n: number };
    const countTests = db
      .prepare(
        `SELECT COUNT(*) AS n FROM test_runs
         WHERE feature_node_id IN (SELECT id FROM feature_nodes WHERE project_id = ?)`,
      )
      .get(project.id) as { n: number };
    check(
      "pre-delete: 3 nodes, 1 ai_run, 2 test_runs",
      countNodes.n === 3 && countRuns.n === 1 && countTests.n === 2,
      `nodes=${countNodes.n} runs=${countRuns.n} tests=${countTests.n}`,
    );

    const del = deleteProject(project.id, "admin-test-renamed");
    check("delete ok", del.ok, del.error);
    check(
      "cascade reports ai_runs + test_runs",
      (del.deleted?.ai_runs ?? 0) === 1 &&
        (del.deleted?.test_runs ?? 0) === 2 &&
        (del.deleted?.feature_nodes ?? 0) >= 1,
      JSON.stringify(del.deleted),
    );

    const remainingProjects = db
      .prepare("SELECT COUNT(*) AS n FROM projects WHERE id = ?")
      .get(project.id) as { n: number };
    const remainingNodes = db
      .prepare("SELECT COUNT(*) AS n FROM feature_nodes WHERE project_id = ?")
      .get(project.id) as { n: number };
    check(
      "project row gone",
      remainingProjects.n === 0,
      `count=${remainingProjects.n}`,
    );
    check(
      "feature_nodes gone",
      remainingNodes.n === 0,
      `count=${remainingNodes.n}`,
    );

    const failedChecks = results.filter((r) => !r.ok);
    console.log(
      `\n[admin] ${results.length - failedChecks.length}/${results.length} checks passed`,
    );
    if (failedChecks.length > 0) {
      console.error("[admin] FAIL");
      process.exitCode = 1;
    } else {
      console.log("[admin] PASS");
    }
  } finally {
    closeDb();
    rmSync(sandbox, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error("[admin] fatal:", err);
  process.exit(1);
}
