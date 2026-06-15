-- Compass schema v0.3 + v0.3.1
-- Canonical schema. Applied by src/db/migrate.ts.
-- Idempotent via IF NOT EXISTS.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- projects
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  root_path     TEXT NOT NULL UNIQUE,
  description   TEXT,
  active_phase  TEXT NOT NULL DEFAULT 'v1',
  known_phases  TEXT NOT NULL DEFAULT '["v1"]',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- ============================================================
-- feature_nodes (self-referencing tree)
-- ============================================================
CREATE TABLE IF NOT EXISTS feature_nodes (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id),
  parent_id             TEXT REFERENCES feature_nodes(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL,
  depth                 INTEGER NOT NULL,
  path                  TEXT NOT NULL,
  title                 TEXT NOT NULL,
  description           TEXT,
  status                TEXT NOT NULL,
  source                TEXT NOT NULL,
  phase                 TEXT NOT NULL DEFAULT 'v1',
  test_steps            TEXT,
  user_action_required  TEXT,
  last_tested_at        INTEGER,
  active_ai_run_id      TEXT,
  last_client_touched   TEXT,
  last_touched_at       INTEGER,
  client_participation  TEXT NOT NULL DEFAULT '{}',
  position              INTEGER NOT NULL DEFAULT 0,
  priority              TEXT,
  estimate              TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,

  CHECK (depth >= 0 AND depth <= 3),
  CHECK (kind IN ('module', 'feature', 'task')),
  CHECK (status IN ('planned', 'in_progress', 'ai_completed',
                    'needs_user_action', 'verified', 'broken', 'archived')),
  CHECK (source IN ('ai', 'user')),
  CHECK (priority IN ('P0', 'P1', 'P2', 'P3'))
);

CREATE INDEX IF NOT EXISTS idx_nodes_project_status ON feature_nodes(project_id, status);
CREATE INDEX IF NOT EXISTS idx_nodes_parent        ON feature_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_path          ON feature_nodes(path);
CREATE INDEX IF NOT EXISTS idx_nodes_phase         ON feature_nodes(project_id, phase, status);
CREATE INDEX IF NOT EXISTS idx_nodes_last_touched  ON feature_nodes(project_id, last_touched_at DESC);

-- ============================================================
-- ai_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_runs (
  id                    TEXT PRIMARY KEY,
  feature_node_id       TEXT NOT NULL REFERENCES feature_nodes(id) ON DELETE CASCADE,
  client_type           TEXT NOT NULL,
  session_id            TEXT,
  intent                TEXT NOT NULL,
  run_status            TEXT NOT NULL,
  origin                TEXT NOT NULL,
  user_prompt_summary   TEXT,
  plan                  TEXT,
  summary               TEXT,
  commit_sha            TEXT,
  files_touched         TEXT,
  started_at            INTEGER NOT NULL,
  completed_at          INTEGER,

  CHECK (intent IN ('implement', 'fix', 'refactor', 'explore')),
  CHECK (run_status IN ('running', 'completed', 'failed', 'abandoned')),
  CHECK (origin IN ('mcp', 'reconciled'))
);

CREATE INDEX IF NOT EXISTS idx_runs_feature_started ON ai_runs(feature_node_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_session         ON ai_runs(session_id) WHERE session_id IS NOT NULL;

-- ============================================================
-- code_todos
-- ============================================================
CREATE TABLE IF NOT EXISTS code_todos (
  id               TEXT PRIMARY KEY,
  feature_node_id  TEXT NOT NULL REFERENCES feature_nodes(id) ON DELETE CASCADE,
  ai_run_id        TEXT REFERENCES ai_runs(id),
  content          TEXT NOT NULL,
  file_path        TEXT,
  line_number      INTEGER,
  done             INTEGER NOT NULL DEFAULT 0,
  created_by       TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  completed_at     INTEGER,

  CHECK (created_by IN ('ai', 'user')),
  CHECK (done IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_todos_feature_done ON code_todos(feature_node_id, done);

-- ============================================================
-- test_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS test_runs (
  id               TEXT PRIMARY KEY,
  feature_node_id  TEXT NOT NULL REFERENCES feature_nodes(id) ON DELETE CASCADE,
  ai_run_id        TEXT REFERENCES ai_runs(id),
  result           TEXT NOT NULL,
  notes            TEXT,
  tested_at        INTEGER NOT NULL,

  CHECK (result IN ('passed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_test_runs_feature ON test_runs(feature_node_id, tested_at DESC);

-- ============================================================
-- activity_events (raw event stream, append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_events (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id),
  source                TEXT NOT NULL,
  event_type            TEXT NOT NULL,
  payload               TEXT NOT NULL,
  ai_run_id             TEXT REFERENCES ai_runs(id),
  feature_node_id       TEXT REFERENCES feature_nodes(id),
  reconciled            INTEGER NOT NULL DEFAULT 0,
  reconciliation_note   TEXT,
  occurred_at           INTEGER NOT NULL,
  ingested_at           INTEGER NOT NULL,

  CHECK (source IN ('commit', 'fs_watch', 'mcp_call')),
  CHECK (reconciled IN (0, 1, 2))
);

CREATE INDEX IF NOT EXISTS idx_events_project_time   ON activity_events(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_unreconciled   ON activity_events(project_id, reconciled, occurred_at)
  WHERE reconciled = 0;

-- ============================================================
-- feature_dependencies (reserved, MVP unused)
-- ============================================================
CREATE TABLE IF NOT EXISTS feature_dependencies (
  id            TEXT PRIMARY KEY,
  from_node_id  TEXT NOT NULL REFERENCES feature_nodes(id) ON DELETE CASCADE,
  to_node_id    TEXT NOT NULL REFERENCES feature_nodes(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,

  CHECK (kind IN ('blocks', 'related')),
  UNIQUE (from_node_id, to_node_id, kind)
);

-- ============================================================
-- v_client_activity: per-client per-day rollup (v0.3.1)
-- ============================================================
DROP VIEW IF EXISTS v_client_activity;
CREATE VIEW v_client_activity AS
SELECT
  project_id,
  client_type,
  date(started_at / 1000, 'unixepoch') AS day,
  COUNT(*) AS run_count,
  SUM(CASE WHEN run_status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
  SUM(CASE WHEN run_status = 'failed'    THEN 1 ELSE 0 END) AS failed_count,
  SUM(CASE WHEN run_status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned_count
FROM ai_runs
JOIN feature_nodes ON ai_runs.feature_node_id = feature_nodes.id
GROUP BY project_id, client_type, day;
