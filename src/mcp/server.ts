import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodTypeAny } from "zod";
import { migrate } from "../db/migrate.ts";
import { buildContext, recordToolCall, setMcpServer, type ServerContext } from "./context.ts";
import type { ToolResult } from "./tools/shared.ts";

import * as listFeatures from "./tools/list-features.ts";
import * as listSubtree from "./tools/list-subtree.ts";
import * as getFeature from "./tools/get-feature.ts";
import * as listTodos from "./tools/list-todos.ts";
import * as startAiRun from "./tools/start-ai-run.ts";
import * as finishAiRun from "./tools/finish-ai-run.ts";
import * as updateStatusTool from "./tools/update-feature-status.ts";
import * as createNodeTool from "./tools/create-feature-node.ts";
import * as addCodeTodo from "./tools/add-code-todo.ts";
import * as deferFeature from "./tools/defer-feature.ts";
import * as logTestSteps from "./tools/log-test-steps.ts";
import * as handoffBrief from "./tools/handoff-brief.ts";
import * as clientActivity from "./tools/client-activity.ts";

interface ToolModule {
  description: string;
  inputShape: Record<string, ZodTypeAny>;
  handler: (
    ctx: ServerContext,
    args: Record<string, unknown>,
  ) => Promise<ToolResult> | ToolResult;
}

const TOOLS: Record<string, ToolModule> = {
  compass_list_features: listFeatures,
  compass_list_subtree: listSubtree,
  compass_get_feature: getFeature,
  compass_list_todos: listTodos,
  compass_start_ai_run: startAiRun,
  compass_finish_ai_run: finishAiRun,
  compass_update_feature_status: updateStatusTool,
  compass_create_feature_node: createNodeTool,
  compass_add_code_todo: addCodeTodo,
  compass_defer_feature: deferFeature,
  compass_log_test_steps: logTestSteps,
  compass_generate_handoff_brief: handoffBrief,
  compass_get_client_activity: clientActivity,
};

type ToolCallback = (args: Record<string, unknown>) => Promise<ToolResult>;

export function buildServer(): McpServer {
  migrate();

  const server = new McpServer(
    { name: "compass", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  for (const [name, mod] of Object.entries(TOOLS)) {
    const cb: ToolCallback = async (args) => {
      const ctx = buildContext();
      recordToolCall(ctx, name, args ?? {});
      return mod.handler(ctx, args ?? {});
    };
    (
      server.registerTool as unknown as (
        n: string,
        cfg: { description: string; inputSchema: Record<string, ZodTypeAny> },
        cb: ToolCallback,
      ) => void
    )(name, { description: mod.description, inputSchema: mod.inputShape }, cb);
  }

  return server;
}

export async function runServer(): Promise<void> {
  const server = buildServer();
  setMcpServer(server.server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runServer().catch((err) => {
    process.stderr.write(`[compass-mcp] fatal: ${err}\n`);
    process.exit(1);
  });
}
