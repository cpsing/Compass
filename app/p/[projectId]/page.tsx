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
  searchParams: Promise<{ phase?: string; status?: string }>;
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
  const statusFilter = sp.status ?? undefined;
  const nodes = listProjectNodes(project.id, {
    phase: phaseFilter,
    include_phase_ancestors: phaseFilter !== undefined,
    status: statusFilter,
  });
  const counts = getProjectCounts(project.id, { phase: phaseFilter });
  const orphanCount = countUnattributed(project.id);

  // Build query string preserving current filters
  const qs = (override: Record<string, string | undefined>) => {
    const merged = { phase: selected, status: statusFilter, ...override };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== project.active_phase) params.set(k, v);
    }
    const s = params.toString();
    return s ? `?${s}` : "";
  };
  // Toggle: clicking the active status clears it
  const statusHref = (s: string) =>
    statusFilter === s ? qs({ status: undefined }) : qs({ status: s });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/" className="text-xs text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            ← all projects
          </Link>
          <h1 className="text-2xl font-semibold mt-2">{project.name}</h1>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1 mono">{project.root_path}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/p/${project.id}/settings`}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
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
        <SummaryChip
          label="total"
          value={counts.total}
          active={!statusFilter}
          href={qs({ status: undefined })}
        />
        <SummaryChip
          label="planned"
          value={counts.planned}
          tone="gray"
          active={statusFilter === "planned"}
          href={statusHref("planned")}
        />
        <SummaryChip
          label="in progress"
          value={counts.in_progress}
          tone="blue"
          active={statusFilter === "in_progress"}
          href={statusHref("in_progress")}
        />
        <SummaryChip
          label="awaiting test"
          value={counts.ai_completed}
          tone="purple"
          active={statusFilter === "ai_completed"}
          href={statusHref("ai_completed")}
        />
        <SummaryChip
          label="needs you"
          value={counts.needs_user_action}
          tone="yellow"
          active={statusFilter === "needs_user_action"}
          href={statusHref("needs_user_action")}
        />
        <SummaryChip
          label="verified"
          value={counts.verified}
          tone="green"
          active={statusFilter === "verified"}
          href={statusHref("verified")}
        />
        {counts.broken > 0 && (
          <SummaryChip
            label="broken"
            value={counts.broken}
            tone="red"
            active={statusFilter === "broken"}
            href={statusHref("broken")}
          />
        )}
        {orphanCount > 0 && (
          <Link
            href={`/p/${project.id}/orphans`}
            className="ml-auto text-xs px-2 py-1 rounded border border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/30 hover:bg-yellow-100 dark:hover:bg-yellow-900/50 text-yellow-700 dark:text-yellow-200 inline-flex items-center gap-1.5"
          >
            <span className="font-semibold">{orphanCount}</span> unattributed →
          </Link>
        )}
        <Link
          href={`/p/${project.id}/clients`}
          className={`${orphanCount > 0 ? "" : "ml-auto"} text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200`}
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
  active,
  href,
}: {
  label: string;
  value: number;
  tone?: "blue" | "purple" | "yellow" | "green" | "red" | "gray";
  active?: boolean;
  href?: string;
}) {
  const toneClass =
    tone === "blue"
      ? "text-blue-600 dark:text-blue-300"
      : tone === "purple"
        ? "text-purple-600 dark:text-purple-300"
        : tone === "yellow"
          ? "text-yellow-600 dark:text-yellow-300"
          : tone === "green"
            ? "text-green-600 dark:text-green-300"
            : tone === "red"
              ? "text-red-600 dark:text-red-300"
              : tone === "gray"
                ? "text-gray-500 dark:text-gray-400"
                : "text-gray-700 dark:text-gray-200";
  const activeClass = active
    ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40"
    : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900";
  const inner = (
    <span
      className={`inline-flex items-baseline gap-1.5 px-2 py-1 rounded border cursor-pointer transition-colors ${activeClass} ${active ? "" : "hover:border-gray-400 dark:hover:border-gray-600"}`}
    >
      <span className={`font-semibold ${toneClass}`}>{value}</span>
      <span className="text-xs text-gray-500 dark:text-gray-500">{label}</span>
    </span>
  );
  return href !== undefined ? <Link href={href}>{inner}</Link> : inner;
}
