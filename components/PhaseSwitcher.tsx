import Link from 'next/link';

interface Props {
  projectId: string;
  phases: string[];
  activePhase: string;
  selected: string;
}

export function PhaseSwitcher({ projectId, phases, activePhase, selected }: Props) {
  const options = ['all', ...phases];
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-md bg-gray-900 border border-gray-800">
      {options.map((p) => {
        const isSelected = p === selected;
        const isActive = p === activePhase;
        const href =
          p === activePhase
            ? `/p/${projectId}`
            : `/p/${projectId}?phase=${encodeURIComponent(p)}`;
        return (
          <Link
            key={p}
            href={href}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              isSelected
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            {p}
            {isActive && p !== 'all' ? ' ●' : ''}
          </Link>
        );
      })}
    </div>
  );
}
