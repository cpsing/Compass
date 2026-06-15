import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, listKnownPhases } from "../../../../../lib/projects.ts";
import {
  getNode,
  listRunsByNode,
  listTodos,
  parseFilesTouched,
} from "../../../../../lib/db-facade.ts";
import { StatusBadge } from "../../../../../components/StatusBadge.tsx";
import { ClientChip } from "../../../../../components/ClientChip.tsx";
import { RelativeTime } from "../../../../../components/RelativeTime.tsx";
import { NodeActions } from "../../../../../components/NodeActions.tsx";
import { TodoCheckbox } from "../../../../../components/TodoCheckbox.tsx";
import { EditNodeForm } from "../../../../../components/EditNodeForm.tsx";
import { HardDeleteNodeForm } from "../../../../../components/HardDeleteNodeForm.tsx";
import { PhaseSelector } from "../../../../../components/PhaseSelector.tsx";
import { listTestRunsForNode } from "../../../../../src/db/test-runs.ts";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ projectId: string; nodeId: string }>;
}

export default async function NodeDetailPage({ params }: PageProps) {
  const { projectId, nodeId } = await params;
  const project = getProject(projectId);
  const node = getNode(nodeId);
  if (!project || !node || node.project_id !== project.id) notFound();

  const runs = listRunsByNode(node.id, 10);
  const testRuns = listTestRunsForNode(node.id, 10);
  const openTodos = listTodos({ feature_node_id: node.id, done: false });
  const doneTodos = listTodos({
    feature_node_id: node.id,
    done: true,
    limit: 5,
  });
  const participation = safeParseJson(node.client_participation) as Record<
    string,
    number
  >;
  const parent = node.parent_id ? getNode(node.parent_id) : null;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/p/${project.id}`}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          ← {project.name}
        </Link>
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <div className="text-xs text-gray-500 mono">
            {node.kind} · depth {node.depth}
          </div>
          {parent && (
            <Link
              href={`/p/${project.id}/nodes/${parent.id}`}
              className="text-xs text-gray-400 hover:text-gray-200"
            >
              parent: {parent.title}
            </Link>
          )}
        </div>
        <h1 className="text-2xl font-semibold mt-1">{node.title}</h1>
        {node.description && (
          <p className="text-sm text-gray-300 mt-2">{node.description}</p>
        )}
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <StatusBadge status={node.status} />
          {node.kind === "module" ? (
            <span className="text-xs text-gray-500">
              phase <code className="mono">{node.phase}</code>
            </span>
          ) : (
            <PhaseSelector
              projectId={project.id}
              nodeId={node.id}
              currentPhase={node.phase}
              availablePhases={listKnownPhases(project)}
            />
          )}
          {node.last_client_touched && (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              last touched:
              <ClientChip clientType={node.last_client_touched} />
              <RelativeTime timestamp={node.last_touched_at} />
            </span>
          )}
        </div>
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <NodeActions
            projectId={project.id}
            nodeId={node.id}
            status={node.status}
          />
          <Link
            href={`/p/${project.id}/nodes/${node.id}/handoff`}
            className="text-xs px-3 py-1.5 rounded border border-gray-700 bg-gray-900 hover:bg-gray-800 text-gray-200"
          >
            ⇄ Handoff brief
          </Link>
          <EditNodeForm
            projectId={project.id}
            nodeId={node.id}
            currentTitle={node.title}
            currentDescription={node.description}
            kind={node.kind}
          />
        </div>
      </div>

      {Object.keys(participation).length > 0 && (
        <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h2 className="text-sm font-semibold text-gray-300 mb-2">
            Participated by
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(participation).map(([client, count]) => (
              <span
                key={client}
                className="inline-flex items-center gap-1.5 text-xs"
              >
                <ClientChip clientType={client} />
                <span className="text-gray-500">×{count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {node.status === "needs_user_action" && node.user_action_required && (
        <section className="rounded-lg border border-yellow-900/60 bg-yellow-950/20 p-4">
          <h2 className="text-lg font-semibold text-yellow-300 mb-2">
            ⚠ Required user action
          </h2>
          <pre className="text-sm text-yellow-100 whitespace-pre-wrap font-mono">
            {node.user_action_required.trim()}
          </pre>
        </section>
      )}

      {node.test_steps && (
        <section>
          <h2 className="text-lg font-semibold mb-2">Manual test steps</h2>
          <pre className="text-sm text-gray-200 bg-gray-900 border border-gray-800 rounded p-4 whitespace-pre-wrap">
            {node.test_steps.trim()}
          </pre>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">
          AIRun timeline{" "}
          <span className="text-sm text-gray-500 font-normal">
            ({runs.length})
          </span>
        </h2>
        {runs.length === 0 ? (
          <div className="text-sm text-gray-500 p-4 rounded bg-gray-900 border border-gray-800">
            No AI runs recorded yet.
          </div>
        ) : (
          <div className="space-y-3">
            {runs.map((r, i) => {
              const files = parseFilesTouched(r);
              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-gray-800 bg-gray-900 p-4"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono text-gray-500">
                        #{runs.length - i}
                      </span>
                      <RunStatusBadge status={r.run_status} />
                      <ClientChip clientType={r.client_type} />
                      <span className="text-xs text-gray-500">
                        intent: <code className="mono">{r.intent}</code>
                      </span>
                      {r.origin === "reconciled" && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 italic"
                          title="Derived from commit + fs_watch events, not from an explicit MCP call"
                        >
                          reconciled
                        </span>
                      )}
                    </div>
                    <RelativeTime
                      timestamp={r.started_at}
                      className="text-xs text-gray-500"
                    />
                  </div>
                  {r.user_prompt_summary && (
                    <div className="mt-2 text-xs">
                      <span className="text-gray-500">User asked: </span>
                      <span className="text-gray-200">
                        {r.user_prompt_summary}
                      </span>
                    </div>
                  )}
                  {r.plan && (
                    <details className="mt-2">
                      <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-200">
                        Plan
                      </summary>
                      <pre className="text-xs text-gray-200 mt-1 whitespace-pre-wrap font-mono">
                        {r.plan.trim()}
                      </pre>
                    </details>
                  )}
                  {r.summary && (
                    <div className="mt-2 text-sm text-gray-200">
                      {r.summary}
                    </div>
                  )}
                  {(files.length > 0 || r.commit_sha) && (
                    <div className="mt-2 flex items-center gap-3 flex-wrap text-xs text-gray-500">
                      {files.length > 0 && (
                        <span className="mono">
                          {files.slice(0, 6).join(", ")}
                          {files.length > 6 && ` (+${files.length - 6} more)`}
                        </span>
                      )}
                      {r.commit_sha && (
                        <span className="mono">
                          commit {r.commit_sha.slice(0, 7)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          Open code TODOs{" "}
          <span className="text-sm text-gray-500 font-normal">
            ({openTodos.length})
          </span>
        </h2>
        {openTodos.length === 0 ? (
          <div className="text-sm text-gray-500 p-4 rounded bg-gray-900 border border-gray-800">
            None.
          </div>
        ) : (
          <ul className="space-y-2">
            {openTodos.map((t) => (
              <TodoCheckbox
                key={t.id}
                projectId={project.id}
                nodeId={node.id}
                todoId={t.id}
                content={t.content}
                filePath={t.file_path}
                lineNumber={t.line_number}
                createdBy={t.created_by}
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          Test history{" "}
          <span className="text-sm text-gray-500 font-normal">
            ({testRuns.length})
          </span>
        </h2>
        {testRuns.length === 0 ? (
          <div className="text-sm text-gray-500 p-4 rounded bg-gray-900 border border-gray-800">
            No tests recorded yet. Click Verified / Broken on a queued feature
            to record one.
          </div>
        ) : (
          <ul className="space-y-2">
            {testRuns.map((t) => (
              <li
                key={t.id}
                className={`rounded border px-3 py-2 text-sm ${
                  t.result === "passed"
                    ? "border-green-900/60 bg-green-950/30"
                    : "border-red-900/60 bg-red-950/30"
                }`}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span
                    className={
                      t.result === "passed" ? "text-green-300" : "text-red-300"
                    }
                  >
                    {t.result === "passed" ? "✓ Passed" : "✗ Failed"}
                  </span>
                  <RelativeTime
                    timestamp={t.tested_at}
                    className="text-xs text-gray-500"
                  />
                </div>
                {t.notes && (
                  <div className="mt-1 text-xs text-gray-300 whitespace-pre-wrap">
                    {t.notes}
                  </div>
                )}
                {t.ai_run_id && (
                  <div className="text-[10px] text-gray-500 mono mt-1">
                    against run …{t.ai_run_id.slice(-8)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {doneTodos.length > 0 && (
        <details className="text-sm">
          <summary className="text-gray-500 cursor-pointer hover:text-gray-300">
            Recently completed todos ({doneTodos.length})
          </summary>
          <ul className="mt-2 space-y-1.5 pl-3">
            {doneTodos.map((t) => (
              <li key={t.id} className="text-gray-500 line-through text-xs">
                ✓ {t.content}
              </li>
            ))}
          </ul>
        </details>
      )}

      <section className="pt-6 border-t border-gray-800">
        <h2 className="text-lg font-semibold text-red-300 mb-3">Danger zone</h2>
        <HardDeleteNodeForm
          projectId={project.id}
          nodeId={node.id}
          title={node.title}
          kind={node.kind}
        />
      </section>
    </div>
  );
}

function RunStatusBadge({
  status,
}: {
  status: "running" | "completed" | "failed" | "abandoned";
}) {
  const styles: Record<
    typeof status,
    { bg: string; text: string; label: string }
  > = {
    running: { bg: "bg-blue-700", text: "text-blue-100", label: "⏳ running" },
    completed: {
      bg: "bg-green-700",
      text: "text-green-100",
      label: "✓ completed",
    },
    failed: { bg: "bg-red-700", text: "text-red-100", label: "✗ failed" },
    abandoned: {
      bg: "bg-gray-800",
      text: "text-gray-400",
      label: "⊘ abandoned",
    },
  };
  const s = styles[status];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${s.bg} ${s.text}`}
    >
      {s.label}
    </span>
  );
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
