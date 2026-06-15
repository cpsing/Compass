'use client';

import { useTransition, useState } from 'react';
import { markTodoDoneAction } from '../app/actions/todos.ts';

interface Props {
  projectId: string;
  nodeId: string;
  todoId: string;
  content: string;
  filePath: string | null;
  lineNumber: number | null;
  createdBy: 'ai' | 'user';
}

export function TodoCheckbox({
  projectId,
  nodeId,
  todoId,
  content,
  filePath,
  lineNumber,
  createdBy,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handle = (): void => {
    setError(null);
    startTransition(async () => {
      const result = await markTodoDoneAction(projectId, nodeId, todoId);
      if (!result.ok) setError(result.error ?? 'failed');
    });
  };

  return (
    <li className="rounded border border-gray-800 bg-gray-900 px-3 py-2 text-sm">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={handle}
          disabled={pending}
          className="mt-0.5 w-4 h-4 rounded border border-gray-500 hover:border-green-400 hover:bg-green-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Mark done"
        >
          {pending ? <span className="text-[10px] text-gray-300">…</span> : null}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-gray-200">{content}</div>
          {filePath && (
            <div className="text-xs text-gray-500 mono mt-0.5">
              {filePath}
              {lineNumber ? `:${lineNumber}` : ''}
            </div>
          )}
          {error && <div className="text-xs text-red-400 mt-1">{error}</div>}
        </div>
        <span className="text-xs text-gray-600">by {createdBy}</span>
      </div>
    </li>
  );
}
