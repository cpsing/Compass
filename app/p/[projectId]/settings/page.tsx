import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getProject,
  listKnownPhases,
} from '../../../../lib/projects.ts';
import { openDb } from '../../../../lib/db-facade.ts';
import { RenameProjectForm } from '../../../../components/RenameProjectForm.tsx';
import { DeleteProjectForm } from '../../../../components/DeleteProjectForm.tsx';
import { PhaseManager } from '../../../../components/PhaseManager.tsx';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ projectId: string }>;
}

function loadPhaseUsage(projectId: string): Record<string, number> {
  const db = openDb();
  const rows = db
    .prepare(
      `SELECT phase, COUNT(*) AS n FROM feature_nodes
       WHERE project_id = ? GROUP BY phase`,
    )
    .all(projectId) as Array<{ phase: string; n: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.phase] = r.n;
  return out;
}

export default async function ProjectSettingsPage({ params }: PageProps) {
  const { projectId } = await params;
  const project = getProject(projectId);
  if (!project) notFound();

  const knownPhases = listKnownPhases(project);
  const phaseUsage = loadPhaseUsage(project.id);

  return (
    <div className="space-y-10">
      <div>
        <Link
          href={`/p/${project.id}`}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          ← back to {project.name}
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Project settings</h1>
        <p className="text-xs text-gray-500 mt-1 mono">{project.root_path}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Name</h2>
        <RenameProjectForm
          projectId={project.id}
          currentName={project.name}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Phases</h2>
          <p className="text-sm text-gray-500 mt-1">
            Phases let you scope features to release windows (e.g. v1, v2, someday).
            AI tools can defer features into non-active phases via{' '}
            <code className="mono">compass_defer_feature</code>, but cannot create
            new phases.
          </p>
        </div>
        <PhaseManager
          projectId={project.id}
          knownPhases={knownPhases}
          activePhase={project.active_phase}
          phaseUsage={phaseUsage}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-red-300">Danger zone</h2>
        <div className="rounded-lg border border-red-900/60 bg-red-950/20 p-4">
          <DeleteProjectForm
            projectId={project.id}
            projectName={project.name}
          />
        </div>
      </section>
    </div>
  );
}
