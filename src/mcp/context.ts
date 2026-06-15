import { resolve } from 'node:path';
import { ensureProject, type Project } from '../db/projects.ts';
import { insertEvent } from '../db/events.ts';

export interface ServerContext {
  project: Project;
  client_type: string;
  session_id: string | null;
}

export function resolveProjectRoot(): string {
  const env = process.env.COMPASS_PROJECT_ROOT;
  if (env && env.trim().length > 0) return resolve(env);
  return resolve(process.cwd());
}

export function buildContext(): ServerContext {
  const rootPath = resolveProjectRoot();
  const project = ensureProject(rootPath);
  const client_type = process.env.COMPASS_CLIENT_TYPE ?? 'unknown';
  const session_id = process.env.COMPASS_SESSION_ID ?? null;
  return { project, client_type, session_id };
}

export function recordToolCall(
  ctx: ServerContext,
  toolName: string,
  args: Record<string, unknown>,
): void {
  insertEvent({
    project_id: ctx.project.id,
    source: 'mcp_call',
    event_type: 'tool_call',
    payload: {
      tool_name: toolName,
      args: sanitizeArgs(args),
      session_id: ctx.session_id ?? undefined,
      client_type: ctx.client_type,
    },
  });
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.length > 1024) {
      out[k] = v.slice(0, 1024) + '…[truncated]';
    } else {
      out[k] = v;
    }
  }
  return out;
}
