'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

interface Props {
  projectId: string;
  initialQuery?: string;
  currentParams: Record<string, string | undefined>;
}

export function SearchBar({ projectId, initialQuery = '', currentParams }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(currentParams)) {
        if (v && v !== 'v1') params.set(k, v);
      }
      if (query.trim()) params.set('q', query.trim());
      const qs = params.toString();
      router.push(`/p/${projectId}${qs ? `?${qs}` : ''}`, { scroll: false });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, projectId, router, currentParams]);

  const handleClear = useCallback(() => {
    setQuery('');
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(currentParams)) {
      if (v && v !== 'v1') params.set(k, v);
    }
    const qs = params.toString();
    router.push(`/p/${projectId}${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [projectId, router, currentParams]);

  return (
    <div className="relative flex-1 max-w-md">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search features..."
        className="w-full pl-9 pr-8 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md focus:outline-none focus:border-blue-500 dark:focus:border-blue-600 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
      />
      <svg
        className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      {query && (
        <button
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          aria-label="Clear search"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
