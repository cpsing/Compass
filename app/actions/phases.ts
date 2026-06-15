'use server';

import { revalidatePath } from 'next/cache';
import {
  addPhase,
  renamePhase,
  deletePhase,
  setActivePhase,
  type PhaseOpResult,
} from '../../src/services/phases.ts';

function bust(projectId: string): void {
  revalidatePath(`/p/${projectId}`);
  revalidatePath(`/p/${projectId}/settings`);
  revalidatePath(`/p/${projectId}/test-queue`);
  revalidatePath(`/p/${projectId}/clients`);
  revalidatePath('/');
}

export async function addPhaseAction(
  projectId: string,
  name: string,
): Promise<PhaseOpResult> {
  const r = addPhase(projectId, name);
  if (r.ok) bust(projectId);
  return r;
}

export async function renamePhaseAction(
  projectId: string,
  from: string,
  to: string,
): Promise<PhaseOpResult> {
  const r = renamePhase(projectId, from, to);
  if (r.ok) bust(projectId);
  return r;
}

export async function deletePhaseAction(
  projectId: string,
  name: string,
): Promise<PhaseOpResult> {
  const r = deletePhase(projectId, name);
  if (r.ok) bust(projectId);
  return r;
}

export async function setActivePhaseAction(
  projectId: string,
  name: string,
): Promise<PhaseOpResult> {
  const r = setActivePhase(projectId, name);
  if (r.ok) bust(projectId);
  return r;
}
