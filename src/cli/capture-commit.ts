import { resolve } from 'node:path';
import { migrate } from '../db/migrate.ts';
import { ensureProject } from '../db/projects.ts';
import { insertEvent } from '../db/events.ts';
import { closeDb } from '../db/connection.ts';
import { isGitRepo, gitTopLevel, readCommitInfo } from './git.ts';

export interface CaptureCommitArgs {
  projectRoot: string;
  sha: string;
}

export function captureCommit(args: CaptureCommitArgs): { eventId: string } {
  const rawRoot = resolve(args.projectRoot);

  if (!isGitRepo(rawRoot)) {
    throw new Error(`not a git repo: ${rawRoot}`);
  }
  const rootPath = gitTopLevel(rawRoot);

  migrate();

  const project = ensureProject(rootPath);
  const info = readCommitInfo(rootPath, args.sha);

  const eventId = insertEvent({
    project_id: project.id,
    source: 'commit',
    event_type: 'commit',
    payload: {
      sha: info.sha,
      message: info.message,
      files_changed: info.files_changed,
      lines_added: info.lines_added,
      lines_deleted: info.lines_deleted,
      author: info.author,
      branch: info.branch,
    },
    occurred_at: info.committed_at,
  });

  return { eventId };
}

export function captureCommitCli(rawArgs: string[]): void {
  let projectRoot = '';
  let sha = '';

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    const next = rawArgs[i + 1];
    if (arg === '--project-root' && next) {
      projectRoot = next;
      i++;
    } else if (arg === '--sha' && next) {
      sha = next;
      i++;
    }
  }

  if (!projectRoot || !sha) {
    console.error('usage: compass-cli capture-commit --project-root <path> --sha <sha>');
    process.exit(2);
  }

  try {
    const { eventId } = captureCommit({ projectRoot, sha });
    console.log(`captured ${sha.slice(0, 7)} → event ${eventId}`);
  } finally {
    closeDb();
  }
}
