import Link from 'next/link';
import { listAllProjects, getProjectCounts } from '../lib/projects.ts';
import { RelativeTime } from '../components/RelativeTime.tsx';
import { dbPath } from '../src/shared/paths.ts';

export const dynamic = 'force-dynamic';

export default function ProjectsHome() {
  const projects = listAllProjects();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-sm text-gray-500 mt-1">
          Local SQLite database: <code className="mono text-xs">{dbPath()}</code>
        </p>
      </div>

      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {projects.map((p) => {
            const counts = getProjectCounts(p.id);
            return (
              <Link
                key={p.id}
                href={`/p/${p.id}`}
                className="block p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-400 dark:hover:border-gray-600 transition-colors"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 dark:text-white">{p.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-500 truncate mt-0.5">
                      {p.root_path}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 text-sm">
                    <Stat label="features" value={counts.total} />
                    {counts.needs_user_action > 0 && (
                      <Stat
                        label="needs you"
                        value={counts.needs_user_action}
                        warning
                      />
                    )}
                    {counts.ai_completed > 0 && (
                      <Stat label="to test" value={counts.ai_completed} />
                    )}
                    <Stat label="verified" value={counts.verified} positive />
                    <span className="text-xs text-gray-500 dark:text-gray-500">
                      phase <code className="mono">{p.active_phase}</code>
                    </span>
                    <RelativeTime
                      timestamp={p.updated_at}
                      className="text-xs text-gray-500 dark:text-gray-500"
                    />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  positive,
  warning,
}: {
  label: string;
  value: number;
  positive?: boolean;
  warning?: boolean;
}) {
  const color = warning
    ? 'text-yellow-600 dark:text-yellow-400'
    : positive
      ? 'text-green-600 dark:text-green-400'
      : 'text-gray-700 dark:text-gray-300';
  return (
    <span className="flex items-baseline gap-1">
      <span className={`font-semibold ${color}`}>{value}</span>
      <span className="text-xs text-gray-500 dark:text-gray-500">{label}</span>
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-10 text-center">
      <div className="text-gray-500 dark:text-gray-400">No projects yet.</div>
      <div className="text-xs text-gray-400 dark:text-gray-600 mt-2">
        Projects are auto-registered when an AI client calls a Compass MCP tool,
        or when a git commit fires the post-commit hook.
      </div>
      <div className="text-xs text-gray-400 dark:text-gray-600 mt-3">
        Quick demo:{' '}
        <code className="mono bg-gray-100 dark:bg-gray-900 px-1 py-0.5 rounded">npm run seed:demo</code>
      </div>
    </div>
  );
}
