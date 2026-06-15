'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addPhaseAction,
  deletePhaseAction,
  renamePhaseAction,
  setActivePhaseAction,
} from '../app/actions/phases.ts';

interface Props {
  projectId: string;
  knownPhases: string[];
  activePhase: string;
  phaseUsage: Record<string, number>;
}

export function PhaseManager({
  projectId,
  knownPhases,
  activePhase,
  phaseUsage,
}: Props) {
  const router = useRouter();
  const [newPhase, setNewPhase] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? 'failed');
      else {
        setSuccess(msg);
        router.refresh();
      }
    });
  };

  const onAdd = (): void => {
    if (newPhase.trim().length === 0) return;
    run(
      () => addPhaseAction(projectId, newPhase),
      `Added phase "${newPhase.trim()}"`,
    );
    setNewPhase('');
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-800 bg-gray-900 divide-y divide-gray-800 overflow-hidden">
        {knownPhases.map((p) => (
          <PhaseRow
            key={p}
            projectId={projectId}
            phase={p}
            isActive={p === activePhase}
            usage={phaseUsage[p] ?? 0}
            disabled={pending}
            onRefresh={() => router.refresh()}
            onError={setError}
            onSuccess={setSuccess}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={newPhase}
          disabled={pending}
          placeholder="new phase name (e.g. v2)"
          onChange={(e) => setNewPhase(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAdd()}
          className="text-sm bg-gray-950 border border-gray-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-600 min-w-[14rem]"
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={pending || newPhase.trim().length === 0}
          className="text-xs px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + Add phase
        </button>
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}
      {success && <div className="text-xs text-green-400">{success}</div>}
    </div>
  );
}

interface RowProps {
  projectId: string;
  phase: string;
  isActive: boolean;
  usage: number;
  disabled: boolean;
  onRefresh: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

function PhaseRow({
  projectId,
  phase,
  isActive,
  usage,
  disabled,
  onRefresh,
  onError,
  onSuccess,
}: RowProps) {
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(phase);
  const [pending, startTransition] = useTransition();

  const wrap = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string): void => {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) onError(r.error ?? 'failed');
      else {
        onSuccess(msg);
        onRefresh();
      }
    });
  };

  const submitRename = (): void => {
    if (newName.trim() === phase) {
      setRenaming(false);
      return;
    }
    wrap(
      () => renamePhaseAction(projectId, phase, newName),
      `Renamed "${phase}" → "${newName.trim()}"`,
    );
    setRenaming(false);
  };

  return (
    <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
      {!renaming ? (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <code className="mono text-sm text-gray-200">{phase}</code>
          {isActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-700 text-blue-100">
              active
            </span>
          )}
          <span className="text-xs text-gray-500">
            {usage} feature{usage === 1 ? '' : 's'}
          </span>
        </div>
      ) : (
        <input
          type="text"
          autoFocus
          value={newName}
          disabled={disabled || pending}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitRename();
            if (e.key === 'Escape') {
              setRenaming(false);
              setNewName(phase);
            }
          }}
          className="text-sm bg-gray-950 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-blue-600 flex-1 min-w-[12rem]"
        />
      )}
      <div className="flex items-center gap-2">
        {renaming ? (
          <>
            <button
              type="button"
              onClick={submitRename}
              disabled={pending || newName.trim().length === 0}
              className="text-xs px-2 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setRenaming(false);
                setNewName(phase);
              }}
              disabled={pending}
              className="text-xs text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {!isActive && (
              <button
                type="button"
                onClick={() =>
                  wrap(
                    () => setActivePhaseAction(projectId, phase),
                    `Active phase set to "${phase}"`,
                  )
                }
                disabled={disabled || pending}
                className="text-xs px-2 py-1 rounded border border-gray-700 bg-gray-900 hover:bg-gray-800 text-gray-200"
              >
                Set active
              </button>
            )}
            <button
              type="button"
              onClick={() => setRenaming(true)}
              disabled={disabled || pending}
              className="text-xs px-2 py-1 rounded border border-gray-700 bg-gray-900 hover:bg-gray-800 text-gray-200"
            >
              Rename
            </button>
            <button
              type="button"
              disabled={disabled || pending || isActive || usage > 0}
              title={
                isActive
                  ? 'Cannot delete the active phase'
                  : usage > 0
                    ? 'Phase is used by features; move them first'
                    : 'Delete phase'
              }
              onClick={() =>
                wrap(
                  () => deletePhaseAction(projectId, phase),
                  `Deleted phase "${phase}"`,
                )
              }
              className="text-xs px-2 py-1 rounded border border-red-900/60 bg-red-950/30 hover:bg-red-900/40 text-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
