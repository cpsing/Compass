import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "../../../../lib/projects.ts";
import { listProjectNodes } from "../../../../lib/db-facade.ts";
import { StatusBadge } from "../../../../components/StatusBadge.tsx";
import { ClientChip } from "../../../../components/ClientChip.tsx";
import { RelativeTime } from "../../../../components/RelativeTime.tsx";
import { NodeActions } from "../../../../components/NodeActions.tsx";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function TestQueuePage({ params }: PageProps) {
  const { projectId } = await params;
  const project = getProject(projectId);
  if (!project) notFound();

  const needsAction = listProjectNodes(project.id, {
    status: "needs_user_action",
    phase: project.active_phase,
  });
  const awaitingTest = listProjectNodes(project.id, {
    status: "ai_completed",
    phase: project.active_phase,
  });

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/p/${project.id}`}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          ← back to {project.name}
        </Link>
        <h1 className="text-2xl font-semibold mt-2">What needs you</h1>
        <p className="text-sm text-gray-500 mt-1">
          Phase <code className="mono">{project.active_phase}</code>
        </p>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span className="text-yellow-400">⚠</span> Needs user action
          <span className="text-sm text-gray-500 font-normal">
            ({needsAction.length})
          </span>
        </h2>
        {needsAction.length === 0 ? (
          <div className="text-sm text-gray-500 p-4 rounded bg-gray-900 border border-gray-800">
            No features waiting on you right now.
          </div>
        ) : (
          <div className="rounded-lg border border-yellow-900/60 bg-yellow-950/20 divide-y divide-yellow-900/40 overflow-hidden">
            {needsAction.map((n) => (
              <div key={n.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <Link
                    href={`/p/${project.id}/nodes/${n.id}`}
                    className="font-medium text-white hover:text-yellow-200"
                  >
                    {n.title}
                  </Link>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={n.status} />
                    {n.last_client_touched && (
                      <ClientChip clientType={n.last_client_touched} />
                    )}
                    <RelativeTime
                      timestamp={n.last_touched_at}
                      className="text-xs text-gray-500"
                    />
                  </div>
                </div>
                {n.user_action_required && (
                  <pre className="mt-2 text-xs text-yellow-200 whitespace-pre-wrap font-mono">
                    {n.user_action_required.trim()}
                  </pre>
                )}
                <div className="mt-3">
                  <NodeActions
                    projectId={project.id}
                    nodeId={n.id}
                    status={n.status}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span className="text-purple-400">●</span> Awaiting test
          <span className="text-sm text-gray-500 font-normal">
            ({awaitingTest.length})
          </span>
        </h2>
        {awaitingTest.length === 0 ? (
          <div className="text-sm text-gray-500 p-4 rounded bg-gray-900 border border-gray-800">
            Nothing pending your testing.
          </div>
        ) : (
          <div className="rounded-lg border border-gray-800 divide-y divide-gray-800 overflow-hidden bg-gray-900">
            {awaitingTest.map((n) => (
              <div key={n.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <Link
                      href={`/p/${project.id}/nodes/${n.id}`}
                      className="font-medium text-white hover:text-blue-200"
                    >
                      {n.title}
                    </Link>
                    {n.test_steps && (
                      <div className="text-xs text-gray-500 mt-0.5 truncate max-w-xl">
                        Test:{" "}
                        {n.test_steps.split("\n")[0]?.replace(/^[-*]\s*/, "")}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={n.status} />
                    {n.last_client_touched && (
                      <ClientChip clientType={n.last_client_touched} />
                    )}
                    <RelativeTime
                      timestamp={n.last_touched_at}
                      className="text-xs text-gray-500"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <NodeActions
                    projectId={project.id}
                    nodeId={n.id}
                    status={n.status}
                    compact
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
