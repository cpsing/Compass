import "server-only";
import { openDb } from "../src/db/connection.ts";
import type { Project } from "../src/db/projects.ts";

export function listAllProjects(): Project[] {
  const db = openDb();
  return db
    .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
    .all() as Project[];
}

export function getProject(id: string): Project | null {
  const db = openDb();
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | Project
    | undefined;
  return row ?? null;
}

export interface ProjectCounts {
  total: number;
  in_progress: number;
  ai_completed: number;
  needs_user_action: number;
  verified: number;
  broken: number;
  by_phase: Record<string, number>;
}

export interface ProjectCountsOptions {
  phase?: string;
}

export function getProjectCounts(
  projectId: string,
  options: ProjectCountsOptions = {},
): ProjectCounts {
  const db = openDb();
  // When scoped to a specific phase, exclude modules. Modules are cross-phase
  // containers, not work units, so counting them as "in this phase's progress"
  // is misleading.
  const phaseFilter = options.phase;
  const scopeWhere = phaseFilter ? "AND phase = ? AND kind != 'module'" : "";
  const scopeParams = phaseFilter ? [phaseFilter] : [];

  const statusRows = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM feature_nodes
       WHERE project_id = ? ${scopeWhere}
       GROUP BY status`,
    )
    .all(projectId, ...scopeParams) as Array<{ status: string; n: number }>;

  // by_phase always shows project-wide breakdown so users can see at a glance
  // how features are distributed even when filtered.
  const phaseRows = db
    .prepare(
      `SELECT phase, COUNT(*) AS n FROM feature_nodes
       WHERE project_id = ? AND kind != 'module' GROUP BY phase`,
    )
    .all(projectId) as Array<{ phase: string; n: number }>;
  const by_phase: Record<string, number> = {};
  for (const r of phaseRows) by_phase[r.phase] = r.n;

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM feature_nodes
       WHERE project_id = ? ${scopeWhere}`,
    )
    .get(projectId, ...scopeParams) as { n: number };

  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = r.n;

  return {
    total: totalRow.n,
    in_progress: byStatus.in_progress ?? 0,
    ai_completed: byStatus.ai_completed ?? 0,
    needs_user_action: byStatus.needs_user_action ?? 0,
    verified: byStatus.verified ?? 0,
    broken: byStatus.broken ?? 0,
    by_phase,
  };
}

export function listKnownPhases(project: Project): string[] {
  try {
    const parsed = JSON.parse(project.known_phases);
    return Array.isArray(parsed)
      ? parsed.filter((p): p is string => typeof p === "string")
      : [project.active_phase];
  } catch {
    return [project.active_phase];
  }
}
