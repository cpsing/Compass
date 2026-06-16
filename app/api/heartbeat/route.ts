import { NextResponse } from 'next/server';
import { openDb } from '../../../src/db/connection.ts';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface AggregateRow {
  event_count: number;
  latest_event_at: number | null;
  latest_node_update: number | null;
  latest_run_update: number | null;
}

export async function GET(): Promise<NextResponse> {
  const db = openDb();
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM activity_events)              AS event_count,
         (SELECT MAX(ingested_at) FROM activity_events)      AS latest_event_at,
         (SELECT MAX(updated_at)  FROM feature_nodes)        AS latest_node_update,
         (SELECT MAX(COALESCE(completed_at, started_at)) FROM ai_runs)
                                                              AS latest_run_update`,
    )
    .get() as AggregateRow;

  return NextResponse.json(
    {
      event_count: row.event_count ?? 0,
      latest_event_at: row.latest_event_at ?? null,
      latest_node_update: row.latest_node_update ?? null,
      latest_run_update: row.latest_run_update ?? null,
      server_time: Date.now(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
