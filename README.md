# Compass

> Cross-tool product memory for AI-assisted development.

Compass is a local-first system that gives AI coding tools (Claude Code, Cursor, Claude Desktop) a shared, persistent view of **what features exist, what state each one is in, and what AI did last**. It replaces the mental model you currently keep in your head ("which features are done? which are broken? which AI session touched what?") with a single source of truth that survives across sessions and tools.

---

## Why

If you build software with AI tools, you've probably hit these problems:

- **No memory across tools.** Cursor doesn't know what Claude Code did this morning. You re-explain context every time you switch.
- **No memory across sessions.** "I asked the AI to add CSV export last week — is that actually working?" Git log won't tell you.
- **No test queue.** AI says "done" and you have no idea what to manually verify. Things rot silently.
- **No handoff.** You want to pick up an unfinished feature in a different tool. The new tool starts from zero.

Compass fixes this by making AI tools *report what they did* through an MCP server, and surfacing the state in a local dashboard you can open every morning.

---

## What you get

1. **A "what's done / what needs testing" dashboard** at `http://localhost:18737`
   - ✅ verified features, ⏳ AI-completed (awaiting test), 🚧 in-progress, ❌ broken
2. **Auto-recorded AI runs.** Every non-trivial AI change creates an `AIRun` with intent, plan, summary, files touched, and the originating client (`cursor` / `claude_code` / `claude_desktop`).
3. **Handoff briefs.** Switch tools mid-feature — the next tool calls `compass_generate_handoff_brief` and gets a markdown brief of the prior session's plan, summary, and file diff.
4. **Cross-tool audit.** See which tool produced what, when, with what success rate.
5. **Git reconciliation.** A post-commit hook captures commits; the reconciler links them to the AI run that produced them.

---

## Architecture at a glance

```
┌───────────────────────────┐        ┌──────────────────────────┐
│  AI clients (MCP)         │        │  Web dashboard           │
│  Claude Code / Cursor /   │◀──────▶│  Next.js · /p/[id]       │
│  Claude Desktop           │        │  port 18737               │
└─────────────┬─────────────┘        └─────────────┬────────────┘
              │ stdio MCP                          │
              ▼                                    ▼
        ┌─────────────────────────────────────────────────┐
        │  Compass core (TypeScript)                      │
        │  src/mcp · src/db · src/services · src/reconciler│
        └─────────────────────┬───────────────────────────┘
                              ▼
                  ┌──────────────────────┐
                  │  SQLite              │
                  │  ~/.compass/db.sqlite│
                  └──────────────────────┘
                              ▲
                  ┌───────────┴──────────┐
                  │  Git post-commit hook │
                  │  compass-cli          │
                  └───────────────────────┘
```

- **`src/mcp/`** — MCP server exposing 13 `compass_*` tools to AI clients.
- **`src/db/`** — SQLite schema, migrations, and typed accessors.
- **`src/services/`** — Business logic (phases, test results, orphan assignment).
- **`src/reconciler/`** — Matches git commits to AI runs.
- **`src/cli/`** — `compass-cli` for status, commit capture, and hook install.
- **`src/daemon/`** — Optional file watcher.
- **`app/`** — Next.js dashboard (App Router, server actions).
- **`bin/`** — Launchers (`compass-mcp`, `compass-cli`) for client configs.

---

## Quick start

### 1. Install

```bash
npm install
npm run migrate
```

### 2. Smoke test

```bash
npm run smoke:integration
# expect: [integration] 8/8 checks passed
```

### 3. Run the dashboard

```bash
npm run dev:web
# open http://localhost:18737
```

### 4. Wire an AI client to the MCP server

**Option A: One-command setup (recommended)**

Generate configuration instructions for your AI tool:

```bash
compass-cli setup-prompt --client claude_code
compass-cli setup-prompt --client cursor
compass-cli setup-prompt --client opencode
compass-cli setup-prompt --client claude_desktop
```

Copy the output and follow the steps. This generates MCP server config, git hook installation commands, and system prompts with absolute paths already filled in.

**Option B: Manual setup**

See **[docs/INTEGRATION.md](docs/INTEGRATION.md)** for full instructions. Quick version for Claude Code — drop a `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "compass": {
      "command": "/ABSOLUTE/PATH/TO/Compass/bin/compass-mcp",
      "args": [],
      "env": { "COMPASS_CLIENT_TYPE": "claude_code" }
    }
  }
}
```

Then add the system prompt from `docs/INTEGRATION.md` so the AI actually calls the tools.

---

## MCP tools

| Tool | Purpose |
|---|---|
| `compass_list_features` | List all features in the current project |
| `compass_get_feature` | Get a single feature's detail |
| `compass_list_subtree` | List a feature and its task children |
| `compass_create_feature_node` | Create a `task` node (AI cannot create modules/features) |
| `compass_update_feature_status` | Update status (cannot set `verified` — user-only) |
| `compass_defer_feature` | Move feature to a deferred phase |
| `compass_start_ai_run` | Begin an AI session on a feature (intent + plan) |
| `compass_finish_ai_run` | Close the session (summary + files_touched) |
| `compass_add_code_todo` | Record a deferred sub-task discovered mid-work |
| `compass_list_todos` | List open code todos |
| `compass_log_test_steps` | Log manual test steps generated by AI |
| `compass_generate_handoff_brief` | Markdown brief for picking up work in another tool |
| `compass_client_activity` | Per-client activity rollup |

---

## Scripts

```bash
npm run dev:web         # Next.js dashboard on :18737
npm run build:web       # Production build
npm run start:web       # Production server
npm run mcp             # Run MCP server directly (for debugging)
npm run cli             # Run compass-cli directly
npm run daemon          # File-watcher daemon
npm run migrate         # Apply DB migrations
npm run typecheck       # tsc --noEmit
npm run seed:demo       # Seed a demo project

# Smoke tests
npm run smoke           # core
npm run smoke:hook      # git hook capture
npm run smoke:tree      # tree queries
npm run smoke:recon     # reconciler
npm run smoke:mcp       # MCP tool surface
npm run smoke:orphans   # orphan assignment
npm run smoke:admin     # project admin
npm run smoke:integration  # end-to-end
```

---

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `COMPASS_DATA_DIR` | `~/.compass` | SQLite + log location |
| `COMPASS_PROJECT_ROOT` | `cwd` | Project being tracked |
| `COMPASS_CLIENT_TYPE` | unset | `cursor` / `claude_code` / `claude_desktop` |

All three components (MCP server, dashboard, CLI) must point at the same `COMPASS_DATA_DIR`, otherwise the dashboard will look empty while CLI shows events.

---

## Tech stack

- **Runtime** — Node 20+, TypeScript, `tsx` for direct TS execution
- **Storage** — SQLite via `better-sqlite3` (synchronous, embedded)
- **MCP** — `@modelcontextprotocol/sdk` over stdio
- **Web** — Next.js 16 (App Router, server actions), React 19, Tailwind
- **Validation** — Zod
- **IDs** — ULID

---

## Documentation

- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — Wiring Compass into Claude Desktop / Claude Code / Cursor, system prompt template, manual test plan, troubleshooting.
- [`compass-mvp-architecture-v0.3.1.md`](compass-mvp-architecture-v0.3.1.md) — Latest architecture spec (cross-tool explicitness layer).
- [`compass-mvp-architecture-v0.3.md`](compass-mvp-architecture-v0.3.md) — Full v0.3 architecture.

---

## Status

v0.1.0 — initial public release. Core MCP tools, dashboard, reconciler, and git hook are functional. See `compass-mvp-architecture-v0.3.1.md` for what's next.

## License

Apache 2.0. See [LICENSE](LICENSE).
