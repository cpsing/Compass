'use client';

import { useState } from 'react';

export function CopyButton({
  text,
  label = 'Copy markdown',
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handle = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handle}
      className="text-xs px-2 py-1 rounded border border-gray-700 bg-gray-900 hover:bg-gray-800 text-gray-200"
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
}
