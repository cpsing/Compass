'use client';

import { useState, useTransition } from 'react';
import { hardDeleteNodeAction } from '../app/actions/nodes.ts';

interface Props {
  projectId: string;
  nodeId: string;
  title: string;
  kind: 'module' | 'feature' | 'task';
}

export function HardDeleteNodeForm({
  projectId,
  nodeId,
  title,
  kind,
}: Props) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const matched = confirm === title;

  const submit = (): void => {
    if (!matched) return;
    setError(null);
    startTransition(async () => {
      const r = await hardDeleteNodeAction({
        project_id: projectId,
        node_id: nodeId,
        confirm_title: confirm,
        redirect_to_project: true,
      });
      // On success the action redirects; if we're still here, surface the error.
      if (!r.ok) setError(r.error ?? 'failed');
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-3 py-1.5 rounded border border-red-900/60 bg-red-950/30 hover:bg-red-900/40 text-red-200"
      >
        Hard delete {kind}…
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-red-900/60 bg-red-950/20 p-4 space-y-2 max-w-xl">
      <div className="text-sm text-gray-200">
        Permanently delete this {kind} <strong>and all of its descendants</strong>,
        AI runs, code todos, and test history. Activity events keep their
        timestamps but lose the node/run references.{' '}
        <strong className="text-red-300">This cannot be undone.</strong>
      </div>
      <div className="text-xs text-gray-400">
        Type <code className="mono text-red-300">{title}</code> to confirm:
      </div>
      <input
        type="text"
        autoFocus
        value={confirm}
        disabled={pending}
        placeholder={title}
        onChange={(e) => setConfirm(e.target.value)}
        className="w-full text-sm bg-gray-950 border border-red-900 rounded px-2 py-1.5 focus:outline-none focus:border-red-600"
      />
      {error && <div className="text-xs text-red-400">{error}</div>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!matched || pending}
          className="text-xs px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Deleting…' : 'Delete permanently'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConfirm('');
            setError(null);
          }}
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded text-gray-400 hover:text-gray-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
