import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getProject,
  getProjectCounts,
  listKnownPhases,
} from "../../../lib/projects.ts";
import { listProjectNodes } from "../../../lib/db-facade.ts";
import { countUnattributed } from "../../../src/db/events.ts";
import { TreeView } from "../../../components/TreeView.tsx";
import { PhaseSwitcher } from "../../../components/PhaseSwitcher.tsx";
import { CreateNodeForm } from "../../../components/CreateNodeForm.tsx";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ phase?: string }>;
}

export default async function ProjectTreePage({
  params,
  searchParams,
}: PageProps) {
  const { projectId } = await params;
  const sp = await searchParams;
  const project = getProject(projectId);
  if (!project) notFound();

  const knownPhases = listKnownPhases(project);
  const selected = sp.phase ?? project.active_phase;
  const phaseFilter = selected === "all" ? undefined : selected;
  const nodes = listProjectNodes(project.id, {
    phase: phaseFilter,
    include_phase_ancestors: phaseFilter !== undefined,
  });
  const counts = getProjectCounts(project.id, { phase: phaseFilter });
  const orphanCount = countUnattributed(project.id);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-300">
            ← all projects
          </Link>
          <h1 className="text-2xl font-semibold mt-2">{project.name}</h1>
          <p className="text-xs text-gray-500 mt-1 mono">{project.root_path}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/p/${project.id}/settings`}
            className="text-xs px-2 py-1 rounded border border-gray-700 bg-gray-900 hover:bg-gray-800 text-gray-200"
          >
            Settings
          </Link>
        </div>
      </div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PhaseSwitcher
          projectId={project.id}
          phases={knownPhases}
          activePhase={project.active_phase}
          selected={selected}
        />
      </div>

      <div className="flex items-center gap-4 flex-wrap text-sm">
        <SummaryChip label="total" value={counts.total} />
        <SummaryChip
          label="in progress"
          value={counts.in_progress}
          tone="blue"
        />
        <SummaryChip
          label="awaiting test"
          value={counts.ai_completed}
          tone="purple"
          href={
            counts.ai_completed > 0 ? `/p/${project.id}/test-queue` : undefined
          }
        />
        <SummaryChip
          label="needs you"
          value={counts.needs_user_action}
          tone="yellow"
          href={
            counts.needs_user_action > 0
              ? `/p/${project.id}/test-queue`
              : undefined
          }
        />
        <SummaryChip label="verified" value={counts.verified} tone="green" />
        {counts.broken > 0 && (
          <SummaryChip label="broken" value={counts.broken} tone="red" />
        )}
        {orphanCount > 0 && (
          <Link
            href={`/p/${project.id}/orphans`}
            className="ml-auto text-xs px-2 py-1 rounded border border-yellow-800 bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-200 inline-flex items-center gap-1.5"
          >
            <span className="font-semibold">{orphanCount}</span> unattributed →
          </Link>
        )}
        <Link
          href={`/p/${project.id}/clients`}
          className={`${orphanCount > 0 ? "" : "ml-auto"} text-xs px-2 py-1 rounded border border-gray-700 bg-gray-900 hover:bg-gray-800 text-gray-200`}
        >
          Client activity →
        </Link>
      </div>

      <div>
        <CreateNodeForm projectId={project.id} kind="module" />
      </div>

      <TreeView projectId={project.id} nodes={nodes} />
    </div>
  );
}

function SummaryChip({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: number;
  tone?: "blue" | "purple" | "yellow" | "green" | "red";
  href?: string;
}) {
  const toneClass =
    tone === "blue"
      ? "text-blue-300"
      : tone === "purple"
        ? "text-purple-300"
        : tone === "yellow"
          ? "text-yellow-300"
          : tone === "green"
            ? "text-green-300"
            : tone === "red"
              ? "text-red-300"
              : "text-gray-200";
  const inner = (
    <span className="inline-flex items-baseline gap-1.5 px-2 py-1 rounded bg-gray-900 border border-gray-800">
      <span className={`font-semibold ${toneClass}`}>{value}</span>
      <span className="text-xs text-gray-500">{label}</span>
    </span>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
