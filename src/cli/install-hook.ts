import { existsSync, readFileSync, writeFileSync, renameSync, chmodSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { isGitRepo, gitTopLevel } from './git.ts';

const COMPASS_MARKER = '# COMPASS_HOOK_V1';

export interface InstallHookArgs {
  projectRoot: string;
  cliBin?: string;
  force?: boolean;
}

export interface InstallHookResult {
  hookPath: string;
  action: 'installed' | 'replaced' | 'already_installed';
  backedUp?: string;
}

function buildHookScript(cliBin: string): string {
  return `#!/usr/bin/env bash
${COMPASS_MARKER}
# Installed by Compass. Do not edit manually.
# Re-run \`compass-cli install-hook\` to update.

if command -v ${cliBin.split(' ')[0]} >/dev/null 2>&1 || [ -x "${cliBin.split(' ')[0]}" ]; then
  ${cliBin} capture-commit \\
    --project-root "$(git rev-parse --show-toplevel)" \\
    --sha "$(git rev-parse HEAD)" >/dev/null 2>&1 &
fi

ORIGINAL="$(dirname "$0")/post-commit.original"
if [ -x "$ORIGINAL" ]; then
  "$ORIGINAL" "$@"
fi

exit 0
`;
}

export function installHook(args: InstallHookArgs): InstallHookResult {
  const rawRoot = resolve(args.projectRoot);
  if (!isGitRepo(rawRoot)) {
    throw new Error(`not a git repo: ${rawRoot}`);
  }
  const rootPath = gitTopLevel(rawRoot);
  const hooksDir = join(rootPath, '.git', 'hooks');
  mkdirSync(hooksDir, { recursive: true });

  const hookPath = join(hooksDir, 'post-commit');
  const cliBin = args.cliBin ?? 'compass-cli';
  const newScript = buildHookScript(cliBin);

  let action: InstallHookResult['action'] = 'installed';
  let backedUp: string | undefined;

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, 'utf8');
    if (existing.includes(COMPASS_MARKER)) {
      if (!args.force && existing === newScript) {
        return { hookPath, action: 'already_installed' };
      }
      action = 'replaced';
    } else {
      const originalPath = join(hooksDir, 'post-commit.original');
      renameSync(hookPath, originalPath);
      backedUp = originalPath;
      action = 'replaced';
    }
  }

  writeFileSync(hookPath, newScript, 'utf8');
  chmodSync(hookPath, 0o755);

  return { hookPath, action, backedUp };
}

export function installHookCli(rawArgs: string[]): void {
  let projectRoot = process.cwd();
  let cliBin: string | undefined;
  let force = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    const next = rawArgs[i + 1];
    if (arg === '--project-root' && next) {
      projectRoot = next;
      i++;
    } else if (arg === '--cli-bin' && next) {
      cliBin = next;
      i++;
    } else if (arg === '--force') {
      force = true;
    }
  }

  const result = installHook({ projectRoot, cliBin, force });
  console.log(`hook ${result.action} at ${result.hookPath}`);
  if (result.backedUp) {
    console.log(`backed up existing hook → ${result.backedUp}`);
  }
}
