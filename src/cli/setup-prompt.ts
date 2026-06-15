import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export interface SetupPromptArgs {
  projectRoot: string;
  client?: string;
}

const COMPASS_DIR = resolve(import.meta.dirname, '..', '..');
const BIN_PATH = resolve(COMPASS_DIR, 'bin', 'compass-mcp');

export function setupPromptCli(rawArgs: string[]): void {
  let projectRoot = process.cwd();
  let client = 'claude_code';

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    const next = rawArgs[i + 1];
    if (arg === '--project-root' && next) {
      projectRoot = resolve(next);
      i++;
    } else if (arg === '--client' && next) {
      client = next;
      i++;
    }
  }

  const absProjectRoot = resolve(projectRoot);

  console.log(`# Compass Setup for ${client}`);
  console.log();
  console.log(`## Step 1: Create MCP config`);
  console.log();

  if (client === 'claude_code') {
    console.log(`Create \`.mcp.json\` in ${absProjectRoot}:`);
    console.log();
    console.log('```json');
    console.log(JSON.stringify({
      mcpServers: {
        compass: {
          command: BIN_PATH,
          args: [],
          env: {
            COMPASS_CLIENT_TYPE: 'claude_code',
            COMPASS_PROJECT_ROOT: absProjectRoot,
          },
        },
      },
    }, null, 2));
    console.log('```');
  } else if (client === 'cursor') {
    console.log(`Add to \`.cursor/mcp.json\` in ${absProjectRoot}:`);
    console.log();
    console.log('```json');
    console.log(JSON.stringify({
      mcpServers: {
        compass: {
          command: BIN_PATH,
          args: [],
          env: {
            COMPASS_CLIENT_TYPE: 'cursor',
            COMPASS_PROJECT_ROOT: absProjectRoot,
          },
        },
      },
    }, null, 2));
    console.log('```');
  } else if (client === 'opencode') {
    console.log(`Add to \`~/.config/opencode/config.json\`:`);
    console.log();
    console.log('```json');
    console.log(JSON.stringify({
      mcp: {
        compass: {
          command: BIN_PATH,
          args: [],
          env: {
            COMPASS_CLIENT_TYPE: 'opencode',
            COMPASS_PROJECT_ROOT: absProjectRoot,
          },
        },
      },
    }, null, 2));
    console.log('```');
  } else if (client === 'claude_desktop') {
    console.log(`Add to Claude Desktop config:`);
    console.log();
    console.log('```json');
    console.log(JSON.stringify({
      mcpServers: {
        [`compass-${absProjectRoot.split('/').pop()}`]: {
          command: BIN_PATH,
          args: [],
          env: {
            COMPASS_CLIENT_TYPE: 'claude_desktop',
            COMPASS_PROJECT_ROOT: absProjectRoot,
          },
        },
      },
    }, null, 2));
    console.log('```');
  }

  console.log();
  console.log(`## Step 2: Install git hook`);
  console.log();
  console.log('```bash');
  console.log(`cd ${absProjectRoot}`);
  console.log(`npx tsx ${resolve(COMPASS_DIR, 'src/cli/index.ts')} install-hook --project-root .`);
  console.log('```');
  console.log();

  console.log(`## Step 3: Add system prompt`);
  console.log();
  console.log(`Create \`.claude/system-prompt.md\` (Claude Code) or add to your tool's custom instructions:`);
  console.log();
  console.log('```');
  console.log(`You have access to Compass MCP tools (compass_*) that persist this project's
state across AI sessions. Use them at these moments:

1. At the start of a conversation, call compass_list_features to see what
   already exists before suggesting new features.
2. Before making non-trivial code changes, call compass_start_ai_run with
   intent + a short plan.
3. After finishing implementation, call compass_finish_ai_run with a summary,
   commit SHA, and files touched.
4. If you discover follow-ups, record them with compass_add_code_todo.
5. When switching tools, call compass_generate_handoff_brief.
6. You can only create kind='task' nodes; modules/features are user-created.
7. You cannot set status='verified' — that belongs to the user.`);
  console.log('```');
  console.log();

  console.log(`## Step 4: Start dashboard`);
  console.log();
  console.log('```bash');
  console.log(`cd ${COMPASS_DIR}`);
  console.log(`COMPASS_PROJECT_ROOT=${absProjectRoot} npm run dev:web`);
  console.log('```');
  console.log();
  console.log(`Dashboard: http://localhost:18737`);
  console.log();

  console.log(`## Step 5: Verify`);
  console.log();
  console.log('```bash');
  console.log(`COMPASS_PROJECT_ROOT=${absProjectRoot} npx tsx ${resolve(COMPASS_DIR, 'src/cli/index.ts')} status`);
  console.log('```');
}
