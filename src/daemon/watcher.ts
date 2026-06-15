import chokidar, { type FSWatcher } from 'chokidar';
import { relative } from 'node:path';
import { insertEvent } from '../db/events.ts';

export interface WatcherOptions {
  projectId: string;
  rootPath: string;
  debounceMs?: number;
  onFlush?: (eventId: string, files: string[]) => void;
}

const IGNORED_GLOBS = [
  /(^|[/\\])\../,
  /node_modules/,
  /[/\\]dist[/\\]/,
  /[/\\]build[/\\]/,
  /[/\\]\.next[/\\]/,
  /[/\\]data[/\\]/,
  /\.log$/,
];

interface PendingChange {
  files: Map<string, 'added' | 'modified' | 'removed'>;
  firstAt: number;
  timer: NodeJS.Timeout | null;
}

export function startWatcher(opts: WatcherOptions): FSWatcher {
  const debounceMs = opts.debounceMs ?? 5000;
  const pending: PendingChange = { files: new Map(), firstAt: 0, timer: null };

  const flush = () => {
    if (pending.files.size === 0) return;
    const files = Array.from(pending.files.keys()).sort();
    const changeTypes = files.map((f) => pending.files.get(f)!);
    const windowStart = pending.firstAt;
    const windowEnd = Date.now();

    const eventId = insertEvent({
      project_id: opts.projectId,
      source: 'fs_watch',
      event_type: 'file_changed',
      payload: {
        files,
        change_types: changeTypes,
        window_start: windowStart,
        window_end: windowEnd,
      },
      occurred_at: windowEnd,
    });

    pending.files.clear();
    pending.firstAt = 0;
    pending.timer = null;

    opts.onFlush?.(eventId, files);
  };

  const enqueue = (absPath: string, kind: 'added' | 'modified' | 'removed') => {
    const rel = relative(opts.rootPath, absPath) || absPath;
    if (rel.startsWith('..')) return;

    if (pending.files.size === 0) {
      pending.firstAt = Date.now();
    }
    pending.files.set(rel, kind);

    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(flush, debounceMs);
  };

  const watcher = chokidar.watch(opts.rootPath, {
    ignored: IGNORED_GLOBS,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  watcher
    .on('add', (p) => enqueue(p, 'added'))
    .on('change', (p) => enqueue(p, 'modified'))
    .on('unlink', (p) => enqueue(p, 'removed'));

  return watcher;
}
