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

/** Map known MCP client names to canonical client_type identifiers. */
const KNOWN_CLIENTS: Record<string, string> = {
  'Cursor': 'cursor',
  'cursor': 'cursor',
  'Claude Code': 'claude_code',
  'claude-code': 'claude_code',
  'claude_code': 'claude_code',
  'Claude Desktop': 'claude_desktop',
  'claude-desktop': 'claude_desktop',
  'claude_desktop': 'claude_desktop',
  'opencode': 'opencode',
};

function mapClientInfoName(name: string): string | null {
  if (KNOWN_CLIENTS[name]) return KNOWN_CLIENTS[name]!;
  for (const [key, value] of Object.entries(KNOWN_CLIENTS)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return value;
  }
  return null;
}

function detectParentProcess(): string | null {
  try {
    const ppid = process.ppid;
    if (!ppid) return null;
    const procStat = require('node:fs').readFileSync(`/proc/${ppid}/stat`, 'utf8');
    const commMatch = procStat.match(/\((.+?)\)/);
    if (commMatch) {
      const comm = commMatch[1].toLowerCase();
      if (comm.includes('cursor')) return 'cursor';
      if (comm.includes('claude')) return 'claude_code';
      if (comm.includes('opencode')) return 'opencode';
      if (comm.includes('claude desktop') || comm.includes('anthropic')) return 'claude_desktop';
    }
  } catch {
    // ignore
  }
  return null;
}

let _mcpServer: { getClientVersion?: () => { name: string } | undefined } | null = null;

/** Set the MCP server reference for client detection. */
export function setMcpServer(server: { getClientVersion?: () => { name: string } | undefined }): void {
  _mcpServer = server;
}

export function detectClientType(): string {
  const envVar = process.env.COMPASS_CLIENT_TYPE;
  if (envVar && envVar.trim().length > 0) return envVar.trim();

  const clientVersion = _mcpServer?.getClientVersion?.();
  if (clientVersion?.name) {
    const mapped = mapClientInfoName(clientVersion.name);
    if (mapped) return mapped;
  }

  const parent = detectParentProcess();
  if (parent) return parent;

  return 'unknown';
}

export function buildContext(): ServerContext {
  const rootPath = resolveProjectRoot();
  const project = ensureProject(rootPath);
  const client_type = detectClientType();
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
