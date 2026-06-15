import type { ActivityEvent } from '../db/events.ts';

export const DEFAULT_WINDOW_GAP_MS = 30 * 60 * 1000;

export interface EventWindow {
  start: number;
  end: number;
  events: ActivityEvent[];
}

/**
 * Group events into windows by gap. Events whose occurred_at differs by less
 * than `gapMs` belong to the same window. Input must be ordered by occurred_at.
 */
export function groupIntoWindows(
  events: ActivityEvent[],
  gapMs: number = DEFAULT_WINDOW_GAP_MS,
): EventWindow[] {
  if (events.length === 0) return [];

  const windows: EventWindow[] = [];
  let current: EventWindow = {
    start: events[0]!.occurred_at,
    end: events[0]!.occurred_at,
    events: [events[0]!],
  };

  for (let i = 1; i < events.length; i++) {
    const evt = events[i]!;
    if (evt.occurred_at - current.end <= gapMs) {
      current.end = evt.occurred_at;
      current.events.push(evt);
    } else {
      windows.push(current);
      current = { start: evt.occurred_at, end: evt.occurred_at, events: [evt] };
    }
  }
  windows.push(current);
  return windows;
}
