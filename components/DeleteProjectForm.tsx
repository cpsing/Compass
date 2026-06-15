'use client';

import { useState, useTransition } from 'react';
import { deleteProjectAction } from '../app/actions/project-admin.ts';

interface Props {
  projectId: string;
  projectName: string;
}

export function DeleteProjectForm({ projectId, projectName }: Props) {
  const [confirm, setConfirm] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const matched = confirm === projectName;

  const submit = (): void => {
    if (!matched) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteProjectAction(projectId, confirm);
      if (!r.ok) setError(r.error ?? 'failed');
      // On success, server action redirects to /; we won't reach here.
    });
  };

  return (
    <div className="space-y-2">
      <div className="text-sm text-gray-300">
        Type <code className="mono text-red-300">{projectName}</code> to enable
        delete. This removes the project, all features, AI runs, todos, test
        history, and activity events. <strong>This cannot be undone.</strong>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={confirm}
          disabled={pending}
          placeholder={projectName}
          onChange={(e) => setConfirm(e.target.value)}
          className="text-sm bg-gray-950 border border-red-900 rounded px-2 py-1.5 focus:outline-none focus:border-red-600 min-w-[16rem]"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!matched || pending}
          className="text-xs px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Deleting…' : 'Delete project permanently'}
        </button>
      </div>
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}
