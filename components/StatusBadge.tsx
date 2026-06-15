import type { NodeStatus } from '../lib/db-facade.ts';

const STATUS_STYLES: Record<NodeStatus, { bg: string; text: string; label: string }> = {
  planned: { bg: 'bg-gray-700', text: 'text-gray-200', label: 'planned' },
  in_progress: { bg: 'bg-blue-700', text: 'text-blue-100', label: 'in progress' },
  ai_completed: { bg: 'bg-purple-700', text: 'text-purple-100', label: 'awaiting test' },
  needs_user_action: { bg: 'bg-yellow-600', text: 'text-yellow-50', label: '⚠ needs you' },
  verified: { bg: 'bg-green-700', text: 'text-green-100', label: '✓ verified' },
  broken: { bg: 'bg-red-700', text: 'text-red-100', label: '✗ broken' },
  archived: { bg: 'bg-gray-800', text: 'text-gray-400', label: 'archived' },
};

export function StatusBadge({ status }: { status: NodeStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}
    >
      {s.label}
    </span>
  );
}
