"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createNode,
  getNode,
  listSubtree,
  type NodeStatus,
} from "../../src/db/feature-nodes.ts";
import {
  updateStatus,
  setUserActionRequired,
  updateNode,
  setPhase,
  TrustBoundaryError,
} from "../../src/db/feature-node-mutations.ts";
import {
  hardDeleteNode,
  type HardDeleteResult,
} from "../../src/services/node-admin.ts";
import { getProject, listKnownPhases } from "../../lib/projects.ts";

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

function bustNode(projectId: string, nodeId: string): void {
  revalidatePath(`/p/${projectId}`);
  revalidatePath(`/p/${projectId}/test-queue`);
  revalidatePath(`/p/${projectId}/nodes/${nodeId}`);
  revalidatePath(`/p/${projectId}/clients`);
  revalidatePath("/");
}

function assertProject(nodeId: string, projectId: string): void {
  const node = getNode(nodeId);
  if (!node) throw new Error(`node not found: ${nodeId}`);
  if (node.project_id !== projectId) throw new Error("project mismatch");
}

export async function setNodeStatusAction(
  projectId: string,
  nodeId: string,
  status: NodeStatus,
): Promise<ActionResult> {
  try {
    assertProject(nodeId, projectId);
    updateStatus({ id: nodeId, status, caller: "user" });
    bustNode(projectId, nodeId);
    return { ok: true };
  } catch (err) {
    if (err instanceof TrustBoundaryError)
      return { ok: false, error: err.message };
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function resolveUserActionAction(
  projectId: string,
  nodeId: string,
): Promise<ActionResult> {
  try {
    assertProject(nodeId, projectId);
    updateStatus({ id: nodeId, status: "ai_completed", caller: "user" });
    setUserActionRequired(nodeId, null);
    bustNode(projectId, nodeId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface CreateNodeArgs {
  project_id: string;
  parent_id?: string;
  kind: "module" | "feature" | "task";
  title: string;
  description?: string;
}

export async function createNodeAction(
  args: CreateNodeArgs,
): Promise<ActionResult> {
  try {
    const trimmedTitle = args.title.trim();
    if (trimmedTitle.length === 0) {
      return { ok: false, error: "title cannot be empty" };
    }
    if (args.kind === "feature") {
      if (!args.parent_id) {
        return { ok: false, error: "feature requires a parent module" };
      }
      const parent = getNode(args.parent_id);
      if (!parent) return { ok: false, error: "parent not found" };
      if (parent.kind !== "module") {
        return { ok: false, error: "feature must be a child of a module" };
      }
      if (parent.project_id !== args.project_id) {
        return { ok: false, error: "project mismatch" };
      }
    } else if (args.kind === "task") {
      if (!args.parent_id) {
        return { ok: false, error: "task requires a parent feature" };
      }
      const parent = getNode(args.parent_id);
      if (!parent) return { ok: false, error: "parent not found" };
      if (parent.kind !== "feature") {
        return { ok: false, error: "task must be a child of a feature" };
      }
      if (parent.project_id !== args.project_id) {
        return { ok: false, error: "project mismatch" };
      }
    }
    const node = createNode({
      project_id: args.project_id,
      parent_id: args.parent_id ?? null,
      kind: args.kind,
      title: trimmedTitle,
      description: args.description?.trim() || undefined,
      source: "user",
    });
    revalidatePath(`/p/${args.project_id}`);
    revalidatePath("/");
    return { ok: true, id: node.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface UpdateNodeArgs {
  project_id: string;
  node_id: string;
  title?: string;
  description?: string | null;
}

export async function updateNodeAction(
  args: UpdateNodeArgs,
): Promise<ActionResult> {
  try {
    assertProject(args.node_id, args.project_id);
    updateNode({
      id: args.node_id,
      title: args.title,
      description: args.description,
    });
    bustNode(args.project_id, args.node_id);
    return { ok: true, id: args.node_id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface HardDeleteActionArgs {
  project_id: string;
  node_id: string;
  confirm_title: string;
  redirect_to_project?: boolean;
}

export async function hardDeleteNodeAction(
  args: HardDeleteActionArgs,
): Promise<HardDeleteResult> {
  const node = getNode(args.node_id);
  if (!node) return { ok: false, error: "node not found" };
  if (node.project_id !== args.project_id) {
    return { ok: false, error: "project mismatch" };
  }
  const result = hardDeleteNode(args.node_id, args.confirm_title);
  if (result.ok) {
    revalidatePath(`/p/${args.project_id}`);
    revalidatePath(`/p/${args.project_id}/test-queue`);
    revalidatePath(`/p/${args.project_id}/orphans`);
    revalidatePath(`/p/${args.project_id}/clients`);
    revalidatePath("/");
    if (args.redirect_to_project) {
      redirect(`/p/${args.project_id}`);
    }
  }
  return result;
}

export interface SetNodePhaseArgs {
  project_id: string;
  node_id: string;
  target_phase: string;
}

export async function setNodePhaseAction(
  args: SetNodePhaseArgs,
): Promise<ActionResult & { moved?: number }> {
  try {
    assertProject(args.node_id, args.project_id);
    const node = getNode(args.node_id);
    if (!node) return { ok: false, error: "node not found" };
    if (node.kind === "module") {
      return {
        ok: false,
        error:
          "module phase is fixed; manage phases on the settings page instead",
      };
    }
    const project = getProject(args.project_id);
    if (!project) return { ok: false, error: "project not found" };
    const known = listKnownPhases(project);
    if (!known.includes(args.target_phase)) {
      return {
        ok: false,
        error: `phase "${args.target_phase}" is not in known_phases (${known.join(", ")})`,
      };
    }
    if (node.phase === args.target_phase) {
      return { ok: true, id: args.node_id, moved: 0 };
    }
    const subtree = listSubtree(args.node_id);
    for (const n of subtree) setPhase(n.id, args.target_phase);
    bustNode(args.project_id, args.node_id);
    return { ok: true, id: args.node_id, moved: subtree.length };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
