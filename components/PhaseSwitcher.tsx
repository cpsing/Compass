'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

interface Props {
  projectId: string;
  phases: string[];
  activePhase: string;
  selected: string;
  currentParams?: Record<string, string | undefined>;
}

export function PhaseSwitcher({ projectId, phases, activePhase, selected, currentParams = {} }: Props) {
  const router = useRouter();
  const options = ['all', ...phases];

  const handleClick = useCallback((phase: string) => {
    const params = new URLSearchParams();
    
    // Preserve other params
    for (const [key, value] of Object.entries(currentParams)) {
      if (value && key !== 'phase') {
        params.set(key, value);
      }
    }
    
    // Set phase
    if (phase !== activePhase) {
      params.set('phase', phase);
    }
    
    const queryString = params.toString();
    const href = `/p/${projectId}${queryString ? `?${queryString}` : ''}`;
    
    router.push(href, { scroll: false });
  }, [projectId, activePhase, currentParams, router]);

  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-md bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
      {options.map((p) => {
        const isSelected = p === selected;
        const isActive = p === activePhase;
        return (
          <button
            key={p}
            onClick={() => handleClick(p)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              isSelected
                ? 'bg-blue-600 text-white'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800'
            }`}
          >
            {p}
            {isActive && p !== 'all' ? ' ●' : ''}
          </button>
        );
      })}
    </div>
  );
}
