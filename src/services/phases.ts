import { openDb } from '../db/connection.ts';
import { now } from '../shared/ids.ts';

export interface PhaseOpResult {
  ok: boolean;
  error?: string;
  known_phases?: string[];
  active_phase?: string;
}

interface ProjectRow {
  id: string;
  active_phase: string;
  known_phases: string;
}

function loadProject(projectId: string): ProjectRow | null {
  const db = openDb();
  const row = db
    .prepare(
      'SELECT id, active_phase, known_phases FROM projects WHERE id = ?',
    )
    .get(projectId) as ProjectRow | undefined;
  return row ?? null;
}

function parsePhases(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr)
      ? arr.filter((s): s is string => typeof s === 'string')
      : [];
  } catch {
    return [];
  }
}

function normalize(name: string): string {
  return name.trim();
}

function ok(project: ProjectRow, knownPhases: string[]): PhaseOpResult {
  return {
    ok: true,
    known_phases: knownPhases,
    active_phase: project.active_phase,
  };
}

export function addPhase(projectId: string, name: string): PhaseOpResult {
  const phase = normalize(name);
  if (phase.length === 0) return { ok: false, error: 'phase name cannot be empty' };
  if (phase.length > 32) return { ok: false, error: 'phase name too long (max 32)' };
  if (!/^[a-zA-Z0-9_.\-]+$/.test(phase)) {
    return {
      ok: false,
      error: 'phase name may only contain letters, numbers, ".", "_", "-"',
    };
  }
  const project = loadProject(projectId);
  if (!project) return { ok: false, error: 'project not found' };
  const phases = parsePhases(project.known_phases);
  if (phases.includes(phase)) {
    return { ok: false, error: `phase "${phase}" already exists` };
  }
  const next = [...phases, phase];
  const db = openDb();
  db.prepare(
    'UPDATE projects SET known_phases = ?, updated_at = ? WHERE id = ?',
  ).run(JSON.stringify(next), now(), projectId);
  return ok({ ...project, known_phases: JSON.stringify(next) }, next);
}

export function renamePhase(
  projectId: string,
  from: string,
  to: string,
): PhaseOpResult {
  const oldName = normalize(from);
  const newName = normalize(to);
  if (newName.length === 0) return { ok: false, error: 'new phase name cannot be empty' };
  if (newName === oldName) {
    const project = loadProject(projectId);
    if (!project) return { ok: false, error: 'project not found' };
    return ok(project, parsePhases(project.known_phases));
  }
  if (!/^[a-zA-Z0-9_.\-]+$/.test(newName)) {
    return {
      ok: false,
      error: 'phase name may only contain letters, numbers, ".", "_", "-"',
    };
  }

  const project = loadProject(projectId);
  if (!project) return { ok: false, error: 'project not found' };
  const phases = parsePhases(project.known_phases);
  if (!phases.includes(oldName)) {
    return { ok: false, error: `phase "${oldName}" does not exist` };
  }
  if (phases.includes(newName)) {
    return { ok: false, error: `phase "${newName}" already exists` };
  }

  const db = openDb();
  const ts = now();
  const next = phases.map((p) => (p === oldName ? newName : p));
  const newActive =
    project.active_phase === oldName ? newName : project.active_phase;

  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE projects
       SET known_phases = ?, active_phase = ?, updated_at = ?
       WHERE id = ?`,
    ).run(JSON.stringify(next), newActive, ts, projectId);
    db.prepare(
      `UPDATE feature_nodes
       SET phase = ?, updated_at = ?
       WHERE project_id = ? AND phase = ?`,
    ).run(newName, ts, projectId, oldName);
  });

  try {
    txn();
    return {
      ok: true,
      known_phases: next,
      active_phase: newActive,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function deletePhase(projectId: string, name: string): PhaseOpResult {
  const phase = normalize(name);
  const project = loadProject(projectId);
  if (!project) return { ok: false, error: 'project not found' };
  const phases = parsePhases(project.known_phases);
  if (!phases.includes(phase)) {
    return { ok: false, error: `phase "${phase}" does not exist` };
  }
  if (project.active_phase === phase) {
    return {
      ok: false,
      error: `cannot delete active phase "${phase}" — switch active phase first`,
    };
  }
  if (phases.length === 1) {
    return { ok: false, error: 'cannot delete last remaining phase' };
  }

  const db = openDb();
  const usage = db
    .prepare(
      'SELECT COUNT(*) AS n FROM feature_nodes WHERE project_id = ? AND phase = ?',
    )
    .get(projectId, phase) as { n: number };
  if (usage.n > 0) {
    return {
      ok: false,
      error: `phase "${phase}" has ${usage.n} feature(s); move or archive them first`,
    };
  }

  const next = phases.filter((p) => p !== phase);
  db.prepare(
    'UPDATE projects SET known_phases = ?, updated_at = ? WHERE id = ?',
  ).run(JSON.stringify(next), now(), projectId);
  return ok(project, next);
}

export function setActivePhase(
  projectId: string,
  name: string,
): PhaseOpResult {
  const phase = normalize(name);
  const project = loadProject(projectId);
  if (!project) return { ok: false, error: 'project not found' };
  const phases = parsePhases(project.known_phases);
  if (!phases.includes(phase)) {
    return {
      ok: false,
      error: `phase "${phase}" is not in known_phases — add it first`,
    };
  }
  const db = openDb();
  db.prepare(
    'UPDATE projects SET active_phase = ?, updated_at = ? WHERE id = ?',
  ).run(phase, now(), projectId);
  return { ok: true, known_phases: phases, active_phase: phase };
}
