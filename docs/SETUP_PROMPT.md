# Compass Setup Prompt

Copy this entire prompt and paste it into Claude Code, OpenCode, or any AI coding assistant with MCP support. The AI will automatically configure Compass for your project.

---

## Setup Prompt (copy below)

```
Set up Compass for this project. Compass is a local-first product memory system for AI-assisted development.

Do the following steps:

1. Check if Compass is installed:
   - Look for ~/.compass/db.sqlite
   - Look for compass-dev or Compass directory in common locations (~/, /opt/, current directory)
   - If not found, clone or install Compass from the repository

2. Install dependencies and initialize:
   ```bash
   cd <compass-directory>
   npm install
   npm run migrate
   ```

3. Register this project with Compass:
   - Set COMPASS_PROJECT_ROOT to the current working directory
   - Run: `npx tsx src/cli/index.ts install-hook --project-root $(pwd)`
   - Verify git hook is installed at .git/hooks/post-commit

4. Configure MCP server for AI tools:
   
   For Claude Code, create .mcp.json in project root:
   ```json
   {
     "mcpServers": {
       "compass": {
         "command": "<absolute-path-to-compass>/bin/compass-mcp",
         "args": [],
         "env": {
           "COMPASS_CLIENT_TYPE": "claude_code",
           "COMPASS_PROJECT_ROOT": "<absolute-path-to-current-project>"
         }
       }
     }
   }
   ```
   
   For OpenCode, add to ~/.config/opencode/config.json:
   ```json
   {
     "mcp": {
       "compass": {
         "command": "<absolute-path-to-compass>/bin/compass-mcp",
         "args": [],
         "env": {
           "COMPASS_CLIENT_TYPE": "opencode",
           "COMPASS_PROJECT_ROOT": "<absolute-path-to-current-project>"
         }
       }
     }
   }
   ```
   
   For Cursor, add to .cursor/mcp.json:
   ```json
   {
     "mcpServers": {
       "compass": {
         "command": "<absolute-path-to-compass>/bin/compass-mcp",
         "args": [],
         "env": {
           "COMPASS_CLIENT_TYPE": "cursor",
           "COMPASS_PROJECT_ROOT": "<absolute-path-to-current-project>"
         }
       }
     }
   }
   ```

5. Add system prompt to encourage AI tool usage:
   Create .claude/system-prompt.md (for Claude Code) or equivalent:
   ```
   You have access to Compass MCP tools (compass_*) that persist this project's
   state across AI sessions. Use them at these moments:

   1. At the start of a conversation, call `compass_list_features` to see what
      already exists before suggesting new features.
   2. Before making non-trivial code changes for a specific feature, call
      `compass_start_ai_run` with intent + a short plan.
   3. After finishing the implementation, call `compass_finish_ai_run` with a
      summary, the commit SHA (if any), and the files you touched.
   4. If you discover follow-ups while implementing, record them with
      `compass_add_code_todo`.
   5. When the user wants to switch tools or pick up another tool's work, call
      `compass_generate_handoff_brief` for the target feature.
   6. You can only create kind='task' nodes via `compass_create_feature_node`;
      modules and features are created by the user in the dashboard.
   7. You can move a feature from the active phase to a deferred phase using
      `compass_defer_feature`, but cannot promote deferred features.
   8. You cannot set status='verified' — that boundary belongs to the user.
      Use status 'ai_completed' or 'needs_user_action' when finishing a run.

   Treat these tools as required infrastructure, not optional. If a tool fails,
   surface the error to the user and continue without it.
   ```

6. Start the Compass dashboard:
   ```bash
   cd <compass-directory>
   COMPASS_PROJECT_ROOT=$(pwd) npm run dev:web
   ```
   
   Dashboard will be available at http://localhost:18737

7. Verify setup:
   - Run: `COMPASS_PROJECT_ROOT=$(pwd) npx tsx <compass-directory>/src/cli/index.ts status`
   - Should show project info and activity_events
   - Make a test commit and verify git hook captures it (activity_events count increases)

8. Report back:
   - Confirm which steps succeeded
   - Show the dashboard URL
   - Show the CLI status output
   - List any issues encountered

Now begin setup.
```

---

## Usage

1. Copy the entire "Setup Prompt" section above (everything inside the code block)
2. Open your AI coding tool (Claude Code, OpenCode, Cursor, etc.)
3. Paste the prompt
4. The AI will execute all steps and report back

## Manual Setup

If you prefer manual setup, see [INTEGRATION.md](./INTEGRATION.md) for detailed instructions.

## Troubleshooting

**"compass-mcp not found"**
- Replace `<absolute-path-to-compass>` with the actual absolute path to your Compass installation
- Verify the path exists: `ls <path>/bin/compass-mcp`

**"better-sqlite3 build error"**
- Install build tools: `sudo apt-get install build-essential` (Ubuntu/Debian)
- Then run: `npm rebuild better-sqlite3`

**"Dashboard won't start"**
- Check if port 18737 is already in use: `lsof -i:18737`
- Kill the process or change the port in package.json

**"Git hook not capturing commits"**
- Verify hook exists: `cat .git/hooks/post-commit`
- Should contain `compass-cli capture-commit`
- Re-run: `npx tsx <compass-dir>/src/cli/index.ts install-hook --project-root $(pwd) --force`
