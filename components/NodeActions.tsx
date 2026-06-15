"use client";

import { ActionButton } from "./ActionButton.tsx";
import {
  setNodeStatusAction,
  resolveUserActionAction,
} from "../app/actions/nodes.ts";
import { recordTestResultAction } from "../app/actions/test-results.ts";
import type { NodeStatus } from "../lib/db-facade.ts";

interface Props {
  projectId: string;
  nodeId: string;
  status: NodeStatus;
  compact?: boolean;
}

export function NodeActions({ projectId, nodeId, status, compact }: Props) {
  const showVerifyBroken =
    status === "ai_completed" || status === "broken" || status === "verified";
  const showResolve = status === "needs_user_action";
  const showArchive = status !== "archived";
  const showRestart = status === "archived" || status === "broken";

  return (
    <div
      className={compact ? "flex flex-wrap gap-1.5" : "flex flex-wrap gap-2"}
    >
      {showResolve && (
        <ActionButton
          label="✓ I've done the steps"
          pendingLabel="updating…"
          tone="warning"
          size={compact ? "sm" : "md"}
          onAction={() => resolveUserActionAction(projectId, nodeId)}
        />
      )}
      {showVerifyBroken && status !== "verified" && (
        <ActionButton
          label="✓ Verified"
          tone="success"
          size={compact ? "sm" : "md"}
          onAction={() => recordTestResultAction(projectId, nodeId, "passed")}
        />
      )}
      {showVerifyBroken && status !== "broken" && (
        <ActionButton
          label="✗ Broken"
          tone="danger"
          size={compact ? "sm" : "md"}
          onAction={() => recordTestResultAction(projectId, nodeId, "failed")}
        />
      )}
      {showRestart && (
        <ActionButton
          label="↺ Reopen"
          tone="primary"
          size={compact ? "sm" : "md"}
          onAction={() => setNodeStatusAction(projectId, nodeId, "planned")}
        />
      )}
      {showArchive && (
        <ActionButton
          label="Archive"
          tone="neutral"
          size={compact ? "sm" : "md"}
          confirmMessage="Archive this feature? It will be hidden from the default view."
          onAction={() => setNodeStatusAction(projectId, nodeId, "archived")}
        />
      )}
    </div>
  );
}
