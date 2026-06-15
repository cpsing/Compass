# Compass — Real IDE Integration Guide

This guide gets `compass-mcp` running inside Claude Desktop, Claude Code, and Cursor so the AI can call Compass tools while you work. It is the answer to v0.3 §6.3 assumption 1: **does the AI actually invoke the MCP tools in practice?**

## Prerequisites

1. Clone or open this repo, then install deps once:

   ```bash
   npm install
   ```

2. Confirm the launcher works:

   ```bash
   npm run smoke:integration
   ```

   Expected: `[integration] 8/8 checks passed`.

3. Decide which directory is your "project root" — the codebase you want Compass to track. Set this as `COMPASS_PROJECT_ROOT` in each client's config (see below). It should match the directory you launch the IDE from.

The launcher is at:

```
<repo>/bin/compass-mcp
```

Use the **absolute path** in every client config, not `npx`.

---

## Claude Desktop

Edit (or create) `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) and add a server entry **per project**:

```json
{
  "mcpServers": {
    "compass-myproject": {
      "command": "/ABSOLUTE/PATH/TO/Compass/bin/compass-mcp",
      "args": [],
      "env": {
        "COMPASS_PROJECT_ROOT": "/ABSOLUTE/PATH/TO/your-project",
        "COMPASS_CLIENT_TYPE": "claude_desktop"
      }
    }
  }
}
```

Restart Claude Desktop. The 13 Compass tools should appear in the tool drawer (look for tools prefixed `compass_`).

**Why per-project?** The MCP server can only resolve one project at launch. Have one entry per project you want tracked.

---

## Claude Code

Two options:

### Option A — per-project `.mcp.json`

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "compass": {
      "command": "/ABSOLUTE/PATH/TO/Compass/bin/compass-mcp",
      "args": [],
      "env": {
        "COMPASS_CLIENT_TYPE": "claude_code"
      }
    }
  }
}
```

Claude Code launches MCP servers with cwd = your project root, so you can omit `COMPASS_PROJECT_ROOT` here. Start `claude` from that directory.

### Option B — global `~/.claude.json`

For tools you want available across all projects (note: project resolution will still use whichever cwd `claude` was launched from):

```json
{
  "mcpServers": {
    "compass": {
      "command": "/ABSOLUTE/PATH/TO/Compass/bin/compass-mcp",
      "args": [],
      "env": {
        "COMPASS_CLIENT_TYPE": "claude_code"
      }
    }
  }
}
```

Verify with `claude mcp list` — `compass` should appear.

---

## Cursor

Edit `~/.cursor/mcp.json` (or your workspace's `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "compass": {
      "command": "/ABSOLUTE/PATH/TO/Compass/bin/compass-mcp",
      "args": [],
      "env": {
        "COMPASS_PROJECT_ROOT": "/ABSOLUTE/PATH/TO/your-project",
        "COMPASS_CLIENT_TYPE": "cursor"
      }
    }
  }
}
```

Restart Cursor. Look for `compass_*` tools under your model's available tools.

---

## System prompt to encourage tool use

LLMs forget MCP tools without a nudge. Paste this into the system prompt area (Claude Desktop "Settings → Style" or "custom instructions"; `.claude/system-prompt.md` for Claude Code; Cursor "Rules"):

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

---

## Manual test plan

Run through these once per client. Track results in a simple sheet.

| # | Action | Expected tool call | Verify in |
|---|---|---|---|
| 1 | Open AI chat in project, ask "what's in this project?" | `compass_list_features` | `compass-cli status` shows the call |
| 2 | Pre-create a module + feature via Dashboard (`/p/[id]`, "+ Add module" / "+ Add feature") | n/a | Dashboard tree |
| 3 | Ask AI "implement X" where X = the feature you just made | `compass_start_ai_run` → file edits → `compass_finish_ai_run` | Dashboard node detail shows AIRun timeline with origin=mcp |
| 4 | AI leaves a TODO in code | `compass_add_code_todo` | Dashboard node detail "Open code TODOs" |
| 5 | Mark feature broken in Dashboard ("✗ Broken") | n/a | Test history appears on detail page |
| 6 | Ask AI to "fix it" | new `compass_start_ai_run` with intent=fix | new AIRun |
| 7 | Switch to a 2nd AI client, ask "continue what we were doing in <feature>" | `compass_generate_handoff_brief` | brief contains the prior AIRun's plan + summary |
| 8 | Commit code in your project | git post-commit hook → `compass-cli capture-commit` | `compass-cli status` shows commit event; reconciler links it on next tick |
| 9 | Run `compass-cli status` from project root | n/a | tool-call counts > 0 per session |

After a full week of use, the **key success metric** is:

- Did `mcp_call` events / `commit` events stay roughly proportional? (rough proxy: ≥ 0.5 → AI is calling tools at least half the time something happens)
- Did you adopt the Dashboard for testing decisions (Verified / Broken / needs_user_action resolutions)?

If `mcp_call` rate is low (< 0.2), the system prompt isn't strong enough — iterate on it or add more usage examples in the prompt.

---

## Inspecting what AI did

Three options:

1. **Dashboard**

   ```bash
   COMPASS_DATA_DIR=~/.compass npx next dev -p 3737
   # open http://localhost:3737
   ```

2. **CLI status** (terminal-friendly):

   ```bash
   COMPASS_PROJECT_ROOT=/path/to/project compass-cli status --runs 10 --calls 20
   ```

3. **Raw SQLite** (debugging):

   ```bash
   sqlite3 ~/.compass/db.sqlite
   > SELECT json_extract(payload, '$.tool_name') AS tool, COUNT(*) AS n
     FROM activity_events WHERE source='mcp_call' GROUP BY tool ORDER BY n DESC;
   ```

---

## Troubleshooting

**"Server fails to start" / no compass tools in client**
- Verify `bin/compass-mcp` is executable: `ls -la <repo>/bin/compass-mcp` → should show `rwxr-xr-x`.
- Run the launcher directly: `<repo>/bin/compass-mcp` (stdin should hang waiting for JSON-RPC; that's correct).
- Confirm the absolute path in the client config matches `which compass-mcp` if you installed globally, or the literal repo path otherwise.

**"Tools listed but AI never calls them"**
- Stronger system prompt (see template above). Move it earlier in the prompt order.
- For Claude Desktop, the prompt may not actually attach to every conversation; use "custom instructions".
- Try kickstart phrasing: "Before answering, call compass_list_features to see project state."

**"AI tool calls succeed but Dashboard is empty"**
- `COMPASS_DATA_DIR` mismatch. The MCP server, the Dashboard, and the CLI must all read the same SQLite file. Default is `~/.compass/db.sqlite`. Override consistently if you use a custom dir.
- Check with `compass-cli status` — if the events are there, the Dashboard is pointed at a different DB.

**"Project shows wrong root path / nothing tracked"**
- Set `COMPASS_PROJECT_ROOT` explicitly in the client env, OR launch the client (e.g. `claude`) from the project directory.
- macOS symlink note: `/var/folders` resolves to `/private/var/folders`; the realpath is normalized internally.

**"AI calls compass_create_feature_node and fails"**
- AI can only create `kind='task'` nodes under existing `feature` nodes. Create the module + feature first via Dashboard.

**"Conflict on compass_start_ai_run"**
- Another AI session is already active on this feature. Either finish it via the other client, or run `compass-cli status` to find the stuck run and finish it manually (the dashboard handles this less directly today).

---

## When to declare the integration "working"

Per v0.3 §6.3, the integration is validated if all three are true after a week of real use:

1. AI calls `compass_start_ai_run` / `compass_finish_ai_run` ≥ 60% of the time it does non-trivial feature work
2. You actively use the Dashboard test queue + Handoff brief at least once per multi-session feature
3. Reconciler accuracy (events attributed vs unattributed) ≥ 75% — check `compass-cli status` for the unattributed count vs total

If any of these fails, the issue isn't with the tools — it's with prompting / habit / model quality. Adjust the system prompt and try again before changing code.
