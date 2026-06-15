'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { renameProjectAction } from '../app/actions/project-admin.ts';

interface Props {
  projectId: string;
  currentName: string;
}

export function RenameProjectForm({ projectId, currentName }: Props) {
  const router = useRouter();
  const [name, setName] = useState(currentName);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = (): void => {
    if (name.trim() === currentName) return;
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const r = await renameProjectAction(projectId, name);
      if (!r.ok) {
        setError(r.error ?? 'failed');
      } else {
        setSuccess(true);
        router.refresh();
      }
    });
  };

  const dirty = name.trim() !== currentName && name.trim().length > 0;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="text"
        value={name}
        disabled={pending}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="text-sm bg-gray-950 border border-gray-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-600 min-w-[16rem]"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!dirty || pending}
        className="text-xs px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? 'Saving…' : 'Rename'}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
      {success && <span className="text-xs text-green-400">✓ saved</span>}
    </div>
  );
}
