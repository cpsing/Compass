'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setNodePhaseAction } from '../app/actions/nodes.ts';

interface Props {
  projectId: string;
  nodeId: string;
  currentPhase: string;
  availablePhases: string[];
}

export function PhaseSelector({
  projectId,
  nodeId,
  currentPhase,
  availablePhases,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const target = e.target.value;
    if (target === currentPhase) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const r = await setNodePhaseAction({
        project_id: projectId,
        node_id: nodeId,
        target_phase: target,
      });
      if (!r.ok) {
        setError(r.error ?? 'failed');
      } else {
        const moved = r.moved ?? 0;
        setSuccess(
          moved <= 1
            ? `→ ${target}`
            : `→ ${target} (${moved} node(s) cascaded)`,
        );
        router.refresh();
        setTimeout(() => setSuccess(null), 2000);
      }
    });
  };

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
      <span>phase</span>
      <select
        value={currentPhase}
        disabled={pending}
        onChange={onChange}
        className="text-xs bg-gray-950 border border-gray-700 rounded px-1.5 py-0.5 mono text-gray-200 focus:outline-none focus:border-blue-600 disabled:opacity-60"
      >
        {availablePhases.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      {pending && <span className="text-[10px] text-gray-400">moving…</span>}
      {error && (
        <span className="text-[10px] text-red-400" title={error}>
          ✗ {error.slice(0, 40)}
        </span>
      )}
      {success && (
        <span className="text-[10px] text-green-400">{success}</span>
      )}
    </span>
  );
}
