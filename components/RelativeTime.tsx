interface Props {
  timestamp: number | null;
  prefix?: string;
  className?: string;
}

export function RelativeTime({ timestamp, prefix, className }: Props) {
  if (timestamp === null) return <span className={className}>—</span>;
  const diff = Date.now() - timestamp;
  let label: string;
  if (diff < 0) label = 'in the future';
  else if (diff < 60_000) label = 'just now';
  else if (diff < 3_600_000) label = `${Math.round(diff / 60_000)}m ago`;
  else if (diff < 86_400_000) label = `${Math.round(diff / 3_600_000)}h ago`;
  else if (diff < 30 * 86_400_000) label = `${Math.round(diff / 86_400_000)}d ago`;
  else label = new Date(timestamp).toISOString().split('T')[0]!;

  return (
    <span title={new Date(timestamp).toISOString()} className={className}>
      {prefix ?? ''}
      {label}
    </span>
  );
}
