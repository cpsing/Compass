import {
  listUnreconciled,
  markReconciled,
  markUnattributed,
  type ActivityEvent,
} from '../db/events.ts';
import { createRun, finishRun, getRun } from '../db/ai-runs.ts';
import { touchByClient } from '../db/feature-node-mutations.ts';
import { DEFAULT_WINDOW_GAP_MS, groupIntoWindows } from './window.ts';
import { attributeWindow, buildMatchContext, type Attribution } from './match.ts';

export interface ReconcileOptions {
  gap_ms?: number;
}

export interface ReconcileReport {
  events_total: number;
  events_attributed: number;
  events_unattributed: number;
  runs_created: number;
  windows: number;
}

export function reconcile(
  projectId: string,
  opts: ReconcileOptions = {},
): ReconcileReport {
  const gap = opts.gap_ms ?? DEFAULT_WINDOW_GAP_MS;
  const events = listUnreconciled(projectId);
  if (events.length === 0) {
    return {
      events_total: 0,
      events_attributed: 0,
      events_unattributed: 0,
      runs_created: 0,
      windows: 0,
    };
  }

  const ctx = buildMatchContext(projectId);
  const windows = groupIntoWindows(events, gap);

  let attributed = 0;
  let unattributed = 0;
  let runsCreated = 0;

  for (const window of windows) {
    const attribution = attributeWindow(window, ctx);
    if (!attribution) {
      for (const evt of window.events) {
        markUnattributed(evt.id, 'no signal matched');
        unattributed++;
      }
      continue;
    }

    let runId: string;
    if (attribution.existing_run_id) {
      runId = attribution.existing_run_id;
      const existing = getRun(runId);
      if (existing && existing.run_status === 'running') {
        finishRun({
          id: runId,
          run_status: 'completed',
          summary: attribution.summary,
          files_touched: attribution.files.length > 0 ? attribution.files : null,
          completed_at: window.end,
        });
      }
    } else {
      const created = createRun({
        feature_node_id: attribution.feature_node_id,
        client_type: attribution.client_type,
        intent: attribution.intent,
        run_status: 'completed',
        origin: 'reconciled',
        summary: attribution.summary,
        files_touched: attribution.files.length > 0 ? attribution.files : null,
        started_at: window.start,
        completed_at: window.end,
      });
      runId = created.id;
      runsCreated++;
    }

    try {
      touchByClient(attribution.feature_node_id, attribution.client_type);
    } catch {
      // node may have been deleted; skip touch
    }

    for (const evt of window.events) {
      markReconciled(evt.id, runId, attribution.feature_node_id);
      attributed++;
    }
  }

  return {
    events_total: events.length,
    events_attributed: attributed,
    events_unattributed: unattributed,
    runs_created: runsCreated,
    windows: windows.length,
  };
}

export type { ActivityEvent, Attribution };
