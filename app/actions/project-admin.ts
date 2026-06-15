'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  renameProject,
  deleteProject,
  type ProjectOpResult,
} from '../../src/services/project-admin.ts';

export async function renameProjectAction(
  projectId: string,
  newName: string,
): Promise<ProjectOpResult> {
  const r = renameProject(projectId, newName);
  if (r.ok) {
    revalidatePath(`/p/${projectId}`);
    revalidatePath(`/p/${projectId}/settings`);
    revalidatePath('/');
  }
  return r;
}

export async function deleteProjectAction(
  projectId: string,
  confirmName: string,
): Promise<ProjectOpResult> {
  const r = deleteProject(projectId, confirmName);
  if (r.ok) {
    revalidatePath('/');
    redirect('/');
  }
  return r;
}
