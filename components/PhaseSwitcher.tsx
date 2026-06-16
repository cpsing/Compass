'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { pauseAutoRefresh } from './AutoRefresh.tsx';

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
    // No-op if already on this phase
    if (phase === selected) return;

    // Pause auto-refresh during navigation to prevent race conditions
    pauseAutoRefresh(2000);

    const params = new URLSearchParams();
    
    // Preserve other params
    for (const [key, value] of Object.entries(currentParams)) {
      if (value && key !== 'phase') {
        params.set(key, value);
      }
    }
    
    // Always set phase param (even for active phase) for consistent URL
    params.set('phase', phase);
    
    const href = `/p/${projectId}?${params.toString()}`;
    
    router.replace(href, { scroll: false });
  }, [projectId, selected, currentParams, router]);

  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-md bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
      {options.map((p) => {
        const isSelected = p === selected;
        const isActive = p === activePhase;
        return (
          <button
            key={p}
            onClick={() => handleClick(p)}
            className={`min-w-[48px] px-3 py-2 text-sm font-medium rounded-md text-center transition-colors ${
              isSelected
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700'
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
