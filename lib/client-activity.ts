import 'server-only';
import {
  getClientStats,
  getTopFeaturesByClient,
  type ClientStats,
  type TopFeature,
} from '../src/db/ai-runs.ts';

export interface ClientWithTopFeatures extends ClientStats {
  success_rate: number;
  top_features: TopFeature[];
}

export function getClientsActivity(
  projectId: string,
  sinceMs: number,
  untilMs: number,
  topPerClient = 3,
): ClientWithTopFeatures[] {
  const stats = getClientStats({
    project_id: projectId,
    since_ms: sinceMs,
    until_ms: untilMs,
  });
  return stats.map((s) => ({
    ...s,
    success_rate:
      s.run_count > 0 ? Math.round((s.completed / s.run_count) * 100) / 100 : 0,
    top_features: getTopFeaturesByClient({
      project_id: projectId,
      since_ms: sinceMs,
      until_ms: untilMs,
      client_type: s.client_type,
      limit: topPerClient,
    }),
  }));
}
