import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProject } from '../../../../lib/projects.ts';
import { getClientsActivity } from '../../../../lib/client-activity.ts';
import { ClientChip } from '../../../../components/ClientChip.tsx';
import { RelativeTime } from '../../../../components/RelativeTime.tsx';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ days?: string }>;
}

const DEFAULT_DAYS = 7;
const RANGES = [1, 7, 30, 90];

export default async function ClientsPage({ params, searchParams }: PageProps) {
  const { projectId } = await params;
  const sp = await searchParams;
  const project = getProject(projectId);
  if (!project) notFound();

  const days = Math.max(1, Math.min(365, Number(sp.days ?? DEFAULT_DAYS) || DEFAULT_DAYS));
  const untilMs = Date.now();
  const sinceMs = untilMs - days * 86_400_000;
  const clients = getClientsActivity(project.id, sinceMs, untilMs);

  const totalRuns = clients.reduce((s, c) => s + c.run_count, 0);
  const maxRuns = Math.max(1, ...clients.map((c) => c.run_count));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/p/${project.id}`}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          ← back to {project.name}
        </Link>
        <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
          <h1 className="text-2xl font-semibold">Client activity</h1>
          <div className="flex items-center gap-1 p-1 rounded-md bg-gray-900 border border-gray-800">
            {RANGES.map((d) => {
              const href =
                d === DEFAULT_DAYS
                  ? `/p/${project.id}/clients`
                  : `/p/${project.id}/clients?days=${d}`;
              const isActive = d === days;
              return (
                <Link
                  key={d}
                  href={href}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  {d}d
                </Link>
              );
            })}
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {totalRuns} AI runs across {clients.length} client(s) in the last {days} day(s)
        </p>
      </div>

      {clients.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-800 bg-gray-950 p-10 text-center text-sm text-gray-500">
          No AI activity recorded in this period. Once your AI clients call
          Compass MCP tools (or commits + file changes get reconciled), they'll
          show up here.
        </div>
      ) : (
        <div className="space-y-4">
          {clients.map((c) => (
            <div
              key={c.client_type}
              className="rounded-lg border border-gray-800 bg-gray-900 p-5"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <ClientChip clientType={c.client_type} />
                  <span className="text-2xl font-semibold text-white">
                    {c.run_count}
                  </span>
                  <span className="text-xs text-gray-500">AI runs</span>
                </div>
                <RelativeTime
                  timestamp={c.last_active}
                  prefix="last active "
                  className="text-xs text-gray-500"
                />
              </div>

              <div className="mt-3 h-1.5 bg-gray-800 rounded overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded"
                  style={{ width: `${(c.run_count / maxRuns) * 100}%` }}
                />
              </div>

              <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <Stat
                  label="completed"
                  value={c.completed}
                  tone={c.completed > 0 ? 'green' : 'gray'}
                />
                <Stat
                  label="failed"
                  value={c.failed}
                  tone={c.failed > 0 ? 'red' : 'gray'}
                />
                <Stat
                  label="abandoned"
                  value={c.abandoned}
                  tone={c.abandoned > 0 ? 'yellow' : 'gray'}
                />
                <Stat
                  label="running"
                  value={c.running}
                  tone={c.running > 0 ? 'blue' : 'gray'}
                />
                <Stat
                  label="files touched"
                  value={c.files_touched_count}
                  tone="gray"
                />
              </div>

              <div className="mt-3 text-xs text-gray-500">
                Success rate:{' '}
                <span className="text-gray-200 font-medium">
                  {Math.round(c.success_rate * 100)}%
                </span>
              </div>

              {c.top_features.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs text-gray-500 mb-2">Top features:</div>
                  <ul className="space-y-1">
                    {c.top_features.map((f) => (
                      <li
                        key={f.feature_node_id}
                        className="text-sm flex items-center justify-between gap-3"
                      >
                        <Link
                          href={`/p/${project.id}/nodes/${f.feature_node_id}`}
                          className="text-gray-200 hover:text-blue-300 truncate"
                        >
                          {f.title}
                        </Link>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-gray-500">
                            {f.run_count} run(s)
                          </span>
                          <RelativeTime
                            timestamp={f.last_active}
                            className="text-xs text-gray-600"
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'green' | 'red' | 'yellow' | 'blue' | 'gray';
}) {
  const colors = {
    green: 'text-green-300',
    red: 'text-red-300',
    yellow: 'text-yellow-300',
    blue: 'text-blue-300',
    gray: 'text-gray-300',
  };
  return (
    <div>
      <div className={`text-lg font-semibold ${colors[tone]}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
