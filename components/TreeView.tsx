"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { FeatureNode } from "../lib/db-facade.ts";
import { StatusBadge } from "./StatusBadge.tsx";
import { ClientChip } from "./ClientChip.tsx";
import { RelativeTime } from "./RelativeTime.tsx";
import { CreateNodeForm } from "./CreateNodeForm.tsx";

interface Props {
  projectId: string;
  nodes: FeatureNode[];
}

interface TreeNode {
  node: FeatureNode;
  children: TreeNode[];
}

function buildTree(nodes: FeatureNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const n of nodes) byId.set(n.id, { node: n, children: [] });
  const roots: TreeNode[] = [];
  for (const tn of byId.values()) {
    if (tn.node.parent_id && byId.has(tn.node.parent_id)) {
      byId.get(tn.node.parent_id)!.children.push(tn);
    } else {
      roots.push(tn);
    }
  }
  const sortChildren = (xs: TreeNode[]): void => {
    xs.sort((a, b) => a.node.path.localeCompare(b.node.path));
    for (const x of xs) sortChildren(x.children);
  };
  sortChildren(roots);
  return roots;
}

const STORAGE_PREFIX = "compass:expanded";

function useExpandedState(
  key: string,
  defaultValue: boolean,
): [boolean, () => void] {
  // Initial render uses default (matches SSR). After mount, read localStorage
  // and apply if a stored value exists. Brief flash is acceptable.
  const [expanded, setExpanded] = useState(defaultValue);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === "1" || stored === "0") {
        setExpanded(stored === "1");
      }
    } catch {
      // localStorage unavailable (private mode, server, etc.)
    }
  }, [key]);

  const toggle = (): void => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

  return [expanded, toggle];
}

export function TreeView({ projectId, nodes }: Props) {
  if (nodes.length === 0) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-500 p-6 rounded-lg border border-dashed border-gray-300 dark:border-gray-800">
        No features in this view. Try a different phase or status filter.
      </div>
    );
  }
  const tree = useMemo(() => buildTree(nodes), [nodes]);
  return (
    <div className="rounded-lg border border-gray-300 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800 overflow-hidden">
      {tree.map((tn) => (
        <TreeRow
          key={tn.node.id}
          treeNode={tn}
          projectId={projectId}
          depth={0}
        />
      ))}
    </div>
  );
}

function TreeRow({
  treeNode,
  projectId,
  depth,
}: {
  treeNode: TreeNode;
  projectId: string;
  depth: number;
}) {
  const { node, children } = treeNode;
  const hasChildren = children.length > 0;
  // Default: modules expand to show features; features collapsed to hide tasks
  // until the user dives in. Cuts noise in projects with many tasks.
  // Persisted to localStorage per (project, node) so refresh keeps state.
  const [expanded, toggleExpanded] = useExpandedState(
    `${STORAGE_PREFIX}:${projectId}:${node.id}`,
    node.kind === "module",
  );

  const canAddChild = node.kind === "module" || node.kind === "feature";
  const childKind = node.kind === "module" ? "feature" : "task";
  const titleClass =
    node.kind === "module"
      ? "font-semibold text-gray-900 dark:text-white"
      : node.kind === "feature"
        ? "font-medium text-gray-800 dark:text-gray-100"
        : "text-gray-600 dark:text-gray-300";

  return (
    <>
      <div className="hover:bg-gray-100 dark:hover:bg-gray-900/60 transition-colors">
        <div
          className="flex items-start gap-2 flex-wrap px-4 py-2.5"
          style={{ paddingLeft: 12 + depth * 24 }}
        >
          {/* Chevron / spacer (always reserve 16px to keep titles aligned) */}
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleExpanded();
              }}
              aria-label={expanded ? "Collapse" : "Expand"}
              className="mt-0.5 w-4 h-4 flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 select-none"
            >
              <span
                className={`inline-block transition-transform text-[10px] ${
                  expanded ? "rotate-90" : ""
                }`}
              >
                ▶
              </span>
            </button>
          ) : (
            <span className="w-4 h-4 inline-block" aria-hidden />
          )}

          <Link
            href={`/p/${projectId}/nodes/${node.id}`}
            className="flex items-start gap-2 flex-1 min-w-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm ${titleClass}`}>{node.title}</span>
                {/* Modules are cross-phase containers; their own status is
                    not meaningful (always 'planned' by default). Hide badge
                    to avoid implying phase-bound progress. */}
                {node.kind !== "module" && <StatusBadge status={node.status} />}
                {node.phase !== "v1" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 mono">
                    phase: {node.phase}
                  </span>
                )}
                {hasChildren && !expanded && (
                  <span className="text-[10px] text-gray-500 dark:text-gray-500">
                    +{countDescendants(treeNode)} hidden
                  </span>
                )}
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-2 shrink-0 text-xs text-gray-500 dark:text-gray-500">
            {node.last_touched_at !== null && (
              <>
                {node.last_client_touched && (
                  <ClientChip clientType={node.last_client_touched} />
                )}
                <RelativeTime timestamp={node.last_touched_at} />
              </>
            )}
            {canAddChild && (
              <CreateNodeForm
                projectId={projectId}
                kind={childKind}
                parentId={node.id}
                parentTitle={node.title}
                compact
              />
            )}
          </div>
          {node.user_action_required && node.status === "needs_user_action" && (
            <div className="basis-full text-xs text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-900 rounded px-2 py-1.5 whitespace-pre-wrap mt-1">
              ⚠ {node.user_action_required}
            </div>
          )}
        </div>
      </div>
      {expanded &&
        children.map((child) => (
          <TreeRow
            key={child.node.id}
            treeNode={child}
            projectId={projectId}
            depth={depth + 1}
          />
        ))}
    </>
  );
}

function countDescendants(tn: TreeNode): number {
  let n = 0;
  for (const c of tn.children) n += 1 + countDescendants(c);
  return n;
}
