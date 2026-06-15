import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { migrate } from "../src/db/migrate.ts";
import { ensureProject } from "../src/db/projects.ts";
import { startWatcher } from "../src/daemon/watcher.ts";
import { countEvents, recentEvents } from "../src/db/events.ts";
import { closeDb } from "../src/db/connection.ts";

const EXPECTED_FILE_COUNT = 3;
const DEBOUNCE_MS = 800;
const WAIT_AFTER_WRITES_MS = 1500;

interface FlushRecord {
  eventId: string;
  files: string[];
}

async function main(): Promise<void> {
  const sandbox = mkdtempSync(join(tmpdir(), "compass-smoke-"));
  process.env.COMPASS_DATA_DIR = join(sandbox, ".compass");
  console.log(`[smoke] sandbox=${sandbox}`);
  console.log(`[smoke] data_dir=${process.env.COMPASS_DATA_DIR}`);

  try {
    migrate();
    const project = ensureProject(sandbox, "smoke-test");
    console.log(`[smoke] project=${project.id}`);

    const before = countEvents(project.id);

    const flushes: FlushRecord[] = [];
    const watcher = startWatcher({
      projectId: project.id,
      rootPath: project.root_path,
      debounceMs: DEBOUNCE_MS,
      onFlush: (eventId, files) => {
        flushes.push({ eventId, files });
      },
    });

    await sleep(300);

    for (let i = 0; i < EXPECTED_FILE_COUNT; i++) {
      writeFileSync(resolve(sandbox, `file_${i}.txt`), `hello ${i}\n`);
      await sleep(50);
    }

    await sleep(DEBOUNCE_MS + WAIT_AFTER_WRITES_MS);

    await watcher.close();

    const after = countEvents(project.id);
    const recent = recentEvents(project.id, 5);
    console.log(`[smoke] events before=${before} after=${after}`);
    console.log(`[smoke] flush callbacks=${flushes.length}`);
    if (recent[0]) {
      console.log(
        `[smoke] latest event: ${JSON.stringify(recent[0], null, 2)}`,
      );
    }

    const newEvents = after - before;
    const ok =
      newEvents >= 1 &&
      flushes.length >= 1 &&
      flushes.some((f) => f.files.length === EXPECTED_FILE_COUNT);

    if (!ok) {
      console.error("[smoke] FAIL — expected 1 batched event with 3 files");
      process.exitCode = 1;
    } else {
      console.log("[smoke] PASS");
    }
  } finally {
    closeDb();
    rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[smoke] fatal:", err);
  process.exit(1);
});
