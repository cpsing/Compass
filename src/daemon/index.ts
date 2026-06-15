import { resolve } from 'node:path';
import { migrate } from '../db/migrate.ts';
import { ensureProject } from '../db/projects.ts';
import { startWatcher } from './watcher.ts';
import { closeDb } from '../db/connection.ts';
import { dbPath } from '../shared/paths.ts';

function parseArgs(): { rootPath: string } {
  const arg = process.argv[2];
  const rootPath = resolve(arg ?? process.cwd());
  return { rootPath };
}

async function main(): Promise<void> {
  const { rootPath } = parseArgs();

  migrate();

  const project = ensureProject(rootPath);
  console.log(`[compass] db=${dbPath()}`);
  console.log(`[compass] project=${project.id} root=${project.root_path}`);
  console.log(`[compass] watching… (Ctrl+C to stop)`);

  const watcher = startWatcher({
    projectId: project.id,
    rootPath: project.root_path,
    onFlush: (eventId, files) => {
      console.log(
        `[compass] event=${eventId.slice(-8)} files=${files.length} sample=${files[0] ?? ''}`,
      );
    },
  });

  const shutdown = async (): Promise<void> => {
    console.log('\n[compass] shutting down…');
    await watcher.close();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[compass] fatal:', err);
  process.exit(1);
});
