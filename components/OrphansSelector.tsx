'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignOrphansAction } from '../app/actions/orphans.ts';

export interface OrphanEvent {
  id: string;
  source: 'commit' | 'fs_watch' | 'mcp_call';
  event_type: string;
  occurred_at: number;
  preview: string;
  detail: string;
  files: string[];
}

export interface OrphanGroup {
  start: number;
  end: number;
  events: OrphanEvent[];
}

export interface NodeOption {
  id: string;
  label: string;
  kind: string;
  status: string;
}

interface Props {
  projectId: string;
  groups: OrphanGroup[];
  nodeOptions: NodeOption[];
}

export function OrphansSelector({ projectId, groups, nodeOptions }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetId, setTargetId] = useState<string>(nodeOptions[0]?.id ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const totalEvents = useMemo(
    () => groups.reduce((s, g) => s + g.events.length, 0),
    [groups],
  );

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSuccess(null);
    setError(null);
  };

  const toggleGroup = (events: OrphanEvent[]): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = events.every((e) => next.has(e.id));
      if (allSelected) events.forEach((e) => next.delete(e.id));
      else events.forEach((e) => next.add(e.id));
      return next;
    });
    setSuccess(null);
    setError(null);
  };

  const clear = (): void => setSelected(new Set());

  const assign = (): void => {
    if (selected.size === 0 || !targetId) return;
    setError(null);
    setSuccess(null);
    const ids = Array.from(selected);
    startTransition(async () => {
      const result = await assignOrphansAction({
        project_id: projectId,
        event_ids: ids,
        feature_node_id: targetId,
      });
      if (!result.ok) {
        setError(result.error ?? 'failed');
        return;
      }
      setSuccess(
        `Assigned ${result.events_assigned} event(s). Created reconciled run ${result.ai_run_id?.slice(-8)}.`,
      );
      setSelected(new Set());
      router.refresh();
    });
  };

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-800 bg-gray-950 p-10 text-center text-sm text-gray-500">
        Nothing unattributed right now. The reconciler links events to AI runs
        automatically; anything that fails all 4 signals lands here.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-10 rounded-lg border border-gray-800 bg-gray-900/95 backdrop-blur p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm">
            <span className="font-semibold text-white">{selected.size}</span>
            <span className="text-gray-500"> / {totalEvents} selected</span>
          </span>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            disabled={pending || nodeOptions.length === 0}
            className="text-sm bg-gray-950 border border-gray-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-600"
          >
            {nodeOptions.length === 0 ? (
              <option value="">No nodes available</option>
            ) : (
              nodeOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  [{n.kind}] {n.label} ({n.status})
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            disabled={pending || selected.size === 0 || !targetId}
            onClick={assign}
            className="text-sm px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? 'Assigning…' : `Assign ${selected.size || ''} to selected`}
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={clear}
              className="text-xs text-gray-400 hover:text-gray-200"
            >
              clear
            </button>
          )}
        </div>
        {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
        {success && <div className="mt-2 text-xs text-green-400">{success}</div>}
      </div>

      {groups.map((g, gi) => {
        const allSelected = g.events.every((e) => selected.has(e.id));
        return (
          <div
            key={`${g.start}-${gi}`}
            className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden"
          >
            <div className="px-4 py-2.5 flex items-center justify-between gap-3 bg-gray-950/60 border-b border-gray-800">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  aria-label="Toggle group"
                  checked={allSelected}
                  onChange={() => toggleGroup(g.events)}
                  disabled={pending}
                  className="w-4 h-4 accent-blue-600"
                />
                <span className="text-sm text-gray-300">
                  Window: {new Date(g.start).toLocaleString()} →{' '}
                  {new Date(g.end).toLocaleString()}
                </span>
              </div>
              <span className="text-xs text-gray-500">
                {g.events.length} event(s)
              </span>
            </div>
            <ul className="divide-y divide-gray-800">
              {g.events.map((evt) => (
                <li key={evt.id} className="px-4 py-2.5">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(evt.id)}
                      onChange={() => toggle(evt.id)}
                      disabled={pending}
                      className="mt-0.5 w-4 h-4 accent-blue-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <SourceTag source={evt.source} />
                        <span className="text-xs text-gray-500">
                          {new Date(evt.occurred_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-sm text-gray-200 mt-0.5">
                        {evt.preview}
                      </div>
                      {evt.files.length > 0 && (
                        <div className="text-xs text-gray-500 mono mt-1 truncate">
                          {evt.files.slice(0, 3).join(', ')}
                          {evt.files.length > 3
                            ? ` (+${evt.files.length - 3} more)`
                            : ''}
                        </div>
                      )}
                      {evt.detail && (
                        <details className="mt-1">
                          <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-300">
                            payload
                          </summary>
                          <pre className="text-[10px] text-gray-400 mono whitespace-pre-wrap mt-1">
                            {evt.detail}
                          </pre>
                        </details>
                      )}
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function SourceTag({ source }: { source: OrphanEvent['source'] }) {
  const styles = {
    commit: 'bg-green-900 text-green-200',
    fs_watch: 'bg-blue-900 text-blue-200',
    mcp_call: 'bg-purple-900 text-purple-200',
  } as const;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${styles[source]}`}
    >
      {source}
    </span>
  );
}
