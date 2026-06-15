import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { migrate } from "../src/db/migrate.ts";
import { installHook } from "../src/cli/install-hook.ts";
import { findProjectByRoot } from "../src/db/projects.ts";
import { countEvents, recentEvents } from "../src/db/events.ts";
import { closeDb } from "../src/db/connection.ts";

const HOOK_WAIT_MS = 2000;

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Smoke Test",
      GIT_AUTHOR_EMAIL: "smoke@compass.test",
      GIT_COMMITTER_NAME: "Smoke Test",
      GIT_COMMITTER_EMAIL: "smoke@compass.test",
    },
  }).trim();
}

function devCliBin(): string {
  const tsxBin = resolve("node_modules/.bin/tsx");
  const cliEntry = resolve("src/cli/index.ts");
  return `${tsxBin} ${cliEntry}`;
}

async function main(): Promise<void> {
  const sandbox = mkdtempSync(join(tmpdir(), "compass-hook-"));
  process.env.COMPASS_DATA_DIR = join(sandbox, ".compass");
  console.log(`[smoke-hook] sandbox=${sandbox}`);
  console.log(`[smoke-hook] data_dir=${process.env.COMPASS_DATA_DIR}`);

  try {
    git(["init", "-q", "-b", "main"], sandbox);
    git(["config", "commit.gpgsign", "false"], sandbox);

    migrate();

    const result = installHook({ projectRoot: sandbox, cliBin: devCliBin() });
    console.log(`[smoke-hook] hook ${result.action} → ${result.hookPath}`);
    if (!existsSync(result.hookPath)) {
      throw new Error("hook file not created");
    }
    const hookContent = readFileSync(result.hookPath, "utf8");
    if (!hookContent.includes("COMPASS_HOOK_V1")) {
      throw new Error("hook missing Compass marker");
    }

    writeFileSync(resolve(sandbox, "hello.txt"), "hello compass\n");
    git(["add", "hello.txt"], sandbox);
    git(["commit", "-q", "-m", "feat: initial commit for hook test"], sandbox);
    const sha = git(["rev-parse", "HEAD"], sandbox);
    console.log(`[smoke-hook] commit=${sha.slice(0, 7)}`);

    await sleep(HOOK_WAIT_MS);

    const project = findProjectByRoot(sandbox);
    if (!project) {
      throw new Error("project not auto-registered after hook fired");
    }
    console.log(`[smoke-hook] project=${project.id}`);

    const total = countEvents(project.id);
    const recent = recentEvents(project.id, 5);
    const commitEvents = recent.filter((e) => e.source === "commit");

    console.log(
      `[smoke-hook] total events=${total} commit events=${commitEvents.length}`,
    );
    if (commitEvents[0]) {
      const payload = JSON.parse(commitEvents[0].payload as string);
      console.log(`[smoke-hook] latest commit event:`);
      console.log(`  sha     = ${payload.sha}`);
      console.log(`  message = ${payload.message.trim()}`);
      console.log(`  files   = ${JSON.stringify(payload.files_changed)}`);
      console.log(
        `  +${payload.lines_added} -${payload.lines_deleted}  branch=${payload.branch}`,
      );
    }

    const ok =
      commitEvents.length === 1 &&
      JSON.parse(commitEvents[0]!.payload as string).sha === sha &&
      JSON.parse(commitEvents[0]!.payload as string).files_changed[0] ===
        "hello.txt";

    if (!ok) {
      console.error("[smoke-hook] FAIL — commit event missing or malformed");
      process.exitCode = 1;
    } else {
      console.log("[smoke-hook] PASS");
    }
  } finally {
    closeDb();
    rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[smoke-hook] fatal:", err);
  process.exit(1);
});
