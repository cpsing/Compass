'use client';

import { useTransition, useState } from 'react';
import type { ActionResult } from '../app/actions/nodes.ts';

interface Props {
  label: string;
  pendingLabel?: string;
  tone?: 'success' | 'danger' | 'neutral' | 'warning' | 'primary';
  size?: 'sm' | 'md';
  onAction: () => Promise<ActionResult>;
  confirmMessage?: string;
}

const TONES: Record<NonNullable<Props['tone']>, string> = {
  success:
    'bg-green-700 hover:bg-green-600 text-white border border-green-600',
  danger: 'bg-red-700 hover:bg-red-600 text-white border border-red-600',
  warning:
    'bg-yellow-600 hover:bg-yellow-500 text-yellow-50 border border-yellow-500',
  primary: 'bg-blue-700 hover:bg-blue-600 text-white border border-blue-600',
  neutral:
    'bg-gray-800 hover:bg-gray-700 text-gray-100 border border-gray-700',
};

const SIZES = {
  sm: 'text-xs px-2 py-1',
  md: 'text-sm px-3 py-1.5',
};

export function ActionButton({
  label,
  pendingLabel,
  tone = 'neutral',
  size = 'sm',
  onAction,
  confirmMessage,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handle = (): void => {
    if (confirmMessage && !confirm(confirmMessage)) return;
    setError(null);
    startTransition(async () => {
      const result = await onAction();
      if (!result.ok) setError(result.error ?? 'failed');
    });
  };

  return (
    <span className="inline-flex flex-col gap-0.5">
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        className={`${TONES[tone]} ${SIZES[size]} rounded font-medium disabled:opacity-60 disabled:cursor-not-allowed transition-colors`}
      >
        {pending ? (pendingLabel ?? label + '…') : label}
      </button>
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </span>
  );
}
