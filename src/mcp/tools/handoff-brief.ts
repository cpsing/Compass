import { z } from "zod";
import {
  getNode,
  getChildren,
  type FeatureNode,
} from "../../db/feature-nodes.ts";
import {
  listRunsByNode,
  parseFilesTouched,
  type AiRun,
  type RunStatus,
} from "../../db/ai-runs.ts";
import { listTodos, type CodeTodo } from "../../db/code-todos.ts";
import { now } from "../../shared/ids.ts";
import type { ServerContext } from "../context.ts";
import { errorResult, type ToolResult } from "./shared.ts";

export const inputShape = {
  feature_node_id: z.string().min(1),
  include_children: z.boolean().optional().describe("Default true."),
  include_siblings: z
    .boolean()
    .optional()
    .describe("Include sibling features for broader context. Default false."),
  max_runs: z.number().int().min(1).max(10).optional(),
};

export const description = `Generate a context brief for handing off work between AI tools.

USE THIS WHEN:
- The user says "I was working on this in <other tool>, continue from there"
- The user explicitly says "give me a handoff" / "summarize what was done"
- list_features showed a node was last touched by a different client and the user wants to continue

Returns markdown the user can paste into another AI client, OR you can absorb directly as context.
The brief includes: parent feature status, the last few AIRuns (with plans/summaries), files touched, related code todos, current phase and status.

Abandoned and failed runs are clearly labeled so you do not confuse them with completed work.`;

export function handler(
  ctx: ServerContext,
  args: Record<string, unknown>,
): ToolResult {
  const nodeId = args["feature_node_id"] as string;
  const includeChildren =
    (args["include_children"] as boolean | undefined) ?? true;
  const includeSiblings =
    (args["include_siblings"] as boolean | undefined) ?? false;
  const maxRuns = (args["max_runs"] as number | undefined) ?? 3;

  const node = getNode(nodeId);
  if (!node) return errorResult(`node not found: ${nodeId}`);
  if (node.project_id !== ctx.project.id) {
    return errorResult("node belongs to a different project");
  }

  const parent = node.parent_id ? getNode(node.parent_id) : null;
  const siblings =
    includeSiblings && parent
      ? getChildren(parent.id).filter((c) => c.id !== node.id)
      : [];
  const children = includeChildren ? getChildren(node.id) : [];
  const runs = listRunsByNode(node.id, maxRuns);
  const openTodos = listTodos({ feature_node_id: node.id, done: false });

  const markdown = renderBrief({
    node,
    parent,
    siblings,
    children,
    runs,
    todos: openTodos,
    currentClient: ctx.client_type,
  });

  const structured = {
    feature_node_id: node.id,
    title: node.title,
    status: node.status,
    phase: node.phase,
    last_client_touched: node.last_client_touched,
    parent: parent
      ? { id: parent.id, title: parent.title, status: parent.status }
      : null,
    run_count: runs.length,
    open_todo_count: openTodos.length,
    markdown,
  };

  return {
    content: [{ type: "text", text: markdown }],
    structuredContent: structured,
  };
}

export interface HandoffRenderInput {
  node: FeatureNode;
  parent: FeatureNode | null;
  siblings: FeatureNode[];
  children: FeatureNode[];
  runs: AiRun[];
  todos: CodeTodo[];
  currentClient: string;
}

export function renderHandoffMarkdown(input: HandoffRenderInput): string {
  return renderBrief(input);
}

function renderBrief(input: HandoffRenderInput): string {
  const { node, parent, siblings, children, runs, todos, currentClient } =
    input;
  const lines: string[] = [];

  const title = node.title;
  const trail = parent ? `${parent.title} › ${title}` : title;
  lines.push(`# Handoff Brief: ${title}`);
  lines.push("");
  lines.push(`**Path**: ${trail}`);
  lines.push(
    `**Status**: \`${node.status}\` · **Phase**: \`${node.phase}\` · **Kind**: ${node.kind}`,
  );
  if (node.last_client_touched) {
    const tag =
      node.last_client_touched === currentClient ? " (current client)" : "";
    lines.push(
      `**Last touched**: ${node.last_client_touched}${tag}, ${relativeTime(node.last_touched_at)}`,
    );
  }
  lines.push("");

  if (parent) {
    lines.push(`## Parent feature: ${parent.title}`);
    lines.push(`Status: \`${parent.status}\` · Phase: \`${parent.phase}\``);
    if (parent.description) lines.push("", parent.description.trim());
    lines.push("");
  }

  if (node.status === "needs_user_action" && node.user_action_required) {
    lines.push("## ⚠️ Pending user action");
    lines.push(node.user_action_required.trim());
    lines.push("");
  }

  if (node.test_steps) {
    lines.push("## Manual test steps");
    lines.push(node.test_steps.trim());
    lines.push("");
  }

  lines.push("## Recent AIRuns");
  if (runs.length === 0) {
    lines.push("_No prior AI runs on this feature._");
  } else {
    runs.forEach((r, i) => {
      lines.push(
        `### Run #${runs.length - i} — ${runStatusLabel(r.run_status)} · ${r.client_type} · ${relativeTime(r.started_at)}`,
      );
      lines.push(`**Intent**: ${r.intent} · **Origin**: ${r.origin}`);
      if (r.user_prompt_summary)
        lines.push(`**User asked**: ${r.user_prompt_summary}`);
      if (r.plan) {
        lines.push("**Plan**:");
        lines.push(indent(r.plan));
      }
      if (r.summary) lines.push(`**Summary**: ${r.summary}`);
      const files = parseFilesTouched(r);
      if (files.length > 0) {
        lines.push(
          `**Files touched**: ${files.slice(0, 10).join(", ")}${files.length > 10 ? ` (+${files.length - 10} more)` : ""}`,
        );
      }
      if (r.commit_sha)
        lines.push(`**Commit**: \`${r.commit_sha.slice(0, 7)}\``);
      lines.push("");
    });
  }

  if (todos.length > 0) {
    lines.push("## Open code TODOs");
    for (const t of todos) {
      const loc = t.file_path
        ? ` (\`${t.file_path}${t.line_number ? ":" + t.line_number : ""}\`)`
        : "";
      lines.push(`- [ ] ${t.content}${loc}`);
    }
    lines.push("");
  }

  if (children.length > 0) {
    lines.push("## Children");
    const counts = countByStatus(children);
    lines.push(`Total ${children.length}: ${renderStatusCounts(counts)}`);
    for (const c of children) {
      lines.push(`- \`${c.status}\` · ${c.title}`);
    }
    lines.push("");
  }

  if (siblings.length > 0) {
    lines.push("## Sibling features");
    for (const s of siblings) {
      lines.push(`- \`${s.status}\` · ${s.title}`);
    }
    lines.push("");
  }

  lines.push("## Suggested next step");
  lines.push(suggestNext(node, runs, todos));

  return lines.join("\n");
}

function runStatusLabel(s: RunStatus): string {
  switch (s) {
    case "completed":
      return "✅ completed";
    case "failed":
      return "❌ failed";
    case "abandoned":
      return "⊘ abandoned";
    case "running":
      return "⏳ running";
  }
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => "    " + l)
    .join("\n");
}

function countByStatus(nodes: FeatureNode[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of nodes) out[n.status] = (out[n.status] ?? 0) + 1;
  return out;
}

function renderStatusCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
}

function relativeTime(ts: number | null): string {
  if (ts === null) return "unknown";
  const diff = now() - ts;
  if (diff < 0) return "in the future";
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} hours ago`;
  if (diff < 30 * 86_400_000)
    return `${Math.round(diff / 86_400_000)} days ago`;
  return new Date(ts).toISOString().split("T")[0]!;
}

function suggestNext(
  node: FeatureNode,
  runs: AiRun[],
  todos: CodeTodo[],
): string {
  if (node.status === "needs_user_action") {
    return "Check the **Pending user action** section above. The user must complete those steps before testing — surface them and confirm.";
  }
  if (node.status === "broken") {
    return "This feature is marked broken. Read the most recent AIRun to understand what failed, then propose a fix.";
  }
  if (node.status === "ai_completed") {
    return "The previous AI session said it finished. Ask the user to test the steps above, or read the latest run summary to verify the work is sound before claiming completion again.";
  }
  if (todos.length > 0) {
    return `There are ${todos.length} open code TODO(s) on this feature. Consider tackling them next.`;
  }
  if (runs[0]?.run_status === "abandoned" || runs[0]?.run_status === "failed") {
    return `The most recent run was ${runs[0].run_status}. Read its summary, then either resume or start a new approach.`;
  }
  return "No obvious next step from history alone — confirm with the user what they want done.";
}
