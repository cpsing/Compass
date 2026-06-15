'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateNodeAction } from '../app/actions/nodes.ts';

interface Props {
  projectId: string;
  nodeId: string;
  currentTitle: string;
  currentDescription: string | null;
  kind: 'module' | 'feature' | 'task';
}

export function EditNodeForm({
  projectId,
  nodeId,
  currentTitle,
  currentDescription,
  kind,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(currentTitle);
  const [description, setDescription] = useState(currentDescription ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dirty =
    title.trim() !== currentTitle ||
    (description.trim() || null) !== (currentDescription ?? null);

  const submit = (): void => {
    if (!dirty) {
      setOpen(false);
      return;
    }
    if (title.trim().length === 0) {
      setError('title cannot be empty');
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await updateNodeAction({
        project_id: projectId,
        node_id: nodeId,
        title: title.trim() === currentTitle ? undefined : title,
        description:
          (description.trim() || null) === (currentDescription ?? null)
            ? undefined
            : description.trim() || null,
      });
      if (!r.ok) setError(r.error ?? 'failed');
      else {
        setOpen(false);
        router.refresh();
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-1 rounded border border-gray-700 bg-gray-900 hover:bg-gray-800 text-gray-200"
      >
        ✎ Edit {kind}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-3 space-y-2 max-w-2xl">
      <div className="text-xs text-gray-400">Editing {kind}</div>
      <input
        type="text"
        autoFocus
        value={title}
        disabled={pending}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') {
            setOpen(false);
            setTitle(currentTitle);
            setDescription(currentDescription ?? '');
            setError(null);
          }
        }}
        className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-600"
      />
      <textarea
        value={description}
        placeholder="Description (optional)"
        rows={3}
        disabled={pending}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-600 resize-none"
      />
      {error && <div className="text-xs text-red-400">{error}</div>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !dirty || title.trim().length === 0}
          className="text-xs px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTitle(currentTitle);
            setDescription(currentDescription ?? '');
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
