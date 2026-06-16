'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Heartbeat {
  event_count: number;
  latest_event_at: number | null;
  latest_node_update: number | null;
  latest_run_update: number | null;
}

interface Props {
  intervalMs?: number;
}

// Global pause state to prevent auto-refresh during user interactions
let pauseUntil = 0;
export function pauseAutoRefresh(ms: number): void {
  pauseUntil = Date.now() + ms;
}

export function AutoRefresh({ intervalMs = 3000 }: Props) {
  const router = useRouter();
  const lastBeat = useRef<Heartbeat | null>(null);
  const [status, setStatus] = useState<'idle' | 'ok' | 'changed' | 'error'>('idle');
  const [lastCheck, setLastCheck] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async (force = false): Promise<void> => {
      // Skip if paused due to user interaction
      if (Date.now() < pauseUntil) return;

      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      try {
        const res = await fetch('/api/heartbeat', { cache: 'no-store' });
        if (!res.ok) throw new Error(`heartbeat ${res.status}`);
        const beat = (await res.json()) as Heartbeat;
        if (cancelled) return;

        const prev = lastBeat.current;
        const changed =
          !!prev &&
          (prev.event_count !== beat.event_count ||
            prev.latest_event_at !== beat.latest_event_at ||
            prev.latest_node_update !== beat.latest_node_update ||
            prev.latest_run_update !== beat.latest_run_update);

        lastBeat.current = beat;
        setLastCheck(Date.now());
        if (changed || force) {
          setStatus('changed');
          router.refresh();
          setTimeout(() => {
            if (!cancelled) setStatus('ok');
          }, 800);
        } else {
          setStatus('ok');
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    };

    void poll();
    const id = setInterval(() => void poll(), intervalMs);

    const onVis = (): void => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [intervalMs, router]);

  const color =
    status === 'changed'
      ? 'bg-blue-500'
      : status === 'error'
        ? 'bg-red-500'
        : status === 'ok'
          ? 'bg-green-500'
          : 'bg-gray-500';
  const label =
    status === 'changed'
      ? 'refreshing'
      : status === 'error'
        ? 'paused'
        : status === 'ok'
          ? 'live'
          : 'starting';

  return (
    <div
      className="fixed bottom-3 right-3 z-30 flex items-center gap-1.5 text-[10px] text-gray-500 bg-gray-950/80 backdrop-blur border border-gray-800 rounded-full px-2 py-1 mono"
      title={
        lastCheck
          ? `last check ${new Date(lastCheck).toLocaleTimeString()}`
          : 'starting auto-refresh'
      }
    >
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      {label}
    </div>
  );
}
