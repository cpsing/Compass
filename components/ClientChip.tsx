interface Props {
  clientType: string | null;
  className?: string;
}

const CLIENT_LABELS: Record<string, { short: string; color: string }> = {
  cursor: { short: 'Cursor', color: 'bg-indigo-900 text-indigo-200' },
  claude_code: { short: 'Claude Code', color: 'bg-orange-900 text-orange-200' },
  claude_desktop: { short: 'Claude', color: 'bg-orange-900 text-orange-200' },
  reconciled: { short: 'reconciled', color: 'bg-gray-800 text-gray-400 italic' },
  smoke_test: { short: 'smoke', color: 'bg-gray-700 text-gray-300' },
};

export function ClientChip({ clientType, className }: Props) {
  if (!clientType) return null;
  const meta = CLIENT_LABELS[clientType] ?? {
    short: clientType,
    color: 'bg-gray-700 text-gray-200',
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${meta.color} ${className ?? ''}`}
    >
      {meta.short}
    </span>
  );
}
