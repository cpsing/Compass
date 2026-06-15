'use server';

import { revalidatePath } from 'next/cache';
import {
  assignOrphansToNode,
  type AssignResult,
} from '../../src/services/orphan-assign.ts';

export interface AssignActionArgs {
  project_id: string;
  event_ids: string[];
  feature_node_id: string;
}

export async function assignOrphansAction(
  args: AssignActionArgs,
): Promise<AssignResult> {
  const result = assignOrphansToNode({
    event_ids: args.event_ids,
    feature_node_id: args.feature_node_id,
  });
  if (result.ok) {
    revalidatePath(`/p/${args.project_id}/orphans`);
    revalidatePath(`/p/${args.project_id}`);
    revalidatePath(`/p/${args.project_id}/nodes/${args.feature_node_id}`);
    revalidatePath(`/p/${args.project_id}/clients`);
  }
  return result;
}
