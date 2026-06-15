import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface ToolCallResult {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

class WrappedClient {
  private proc: ChildProcessWithoutNullStreams;
  private buf = '';
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }
  >();

  constructor(env: Record<string, string>) {
    const launcher = resolve('bin/compass-mcp');
    this.proc = spawn(launcher, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    this.proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) process.stderr.write(`[mcp-stderr] ${text}\n`);
    });
    this.proc.on('error', (err) => {
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });
  }

  private onData(chunk: Buffer): void {
    this.buf += chunk.toString('utf8');
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        if (typeof msg.id === 'number') {
          const handler = this.pending.get(msg.id);
          if (handler) {
            this.pending.delete(msg.id);
            handler.resolve(msg);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0' as const, id, method, params };
    return new Promise((resolveFn, rejectFn) => {
      this.pending.set(id, { resolve: resolveFn, reject: rejectFn });
      this.proc.stdin.write(JSON.stringify(msg) + '\n');
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rejectFn(new Error(`request timeout: ${method}`));
        }
      }, 10000);
    });
  }

  async initialize(): Promise<void> {
    await this.send('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'smoke-launcher-client', version: '0.0.1' },
    });
    this.proc.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      }) + '\n',
    );
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    const resp = await this.send('tools/call', { name, arguments: args });
    if (resp.error) {
      throw new Error(`${name} → ${resp.error.message}`);
    }
    return resp.result as unknown as ToolCallResult;
  }

  async listTools(): Promise<Array<{ name: string }>> {
    const resp = await this.send('tools/list', {});
    return (resp.result?.['tools'] as Array<{ name: string }>) ?? [];
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}
const checks: Check[] = [];
function assert(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
  console.log(
    `  [${ok ? 'OK' : 'FAIL'}] ${name}${detail ? '  — ' + detail : ''}`,
  );
}

async function main(): Promise<void> {
  const sandbox = mkdtempSync(join(tmpdir(), 'compass-launcher-'));
  const projectRoot = join(sandbox, 'project');
  mkdirSync(projectRoot, { recursive: true });

  const env: Record<string, string> = {
    COMPASS_DATA_DIR: join(sandbox, '.compass'),
    COMPASS_PROJECT_ROOT: projectRoot,
    COMPASS_CLIENT_TYPE: 'integration_test',
  };
  console.log(`[integration] sandbox=${sandbox}`);
  console.log(`[integration] launcher=bin/compass-mcp (production-path)`);

  const client = new WrappedClient(env);
  try {
    await client.initialize();

    const tools = await client.listTools();
    assert(
      'bash launcher spawns server and exposes 13 tools',
      tools.length === 13,
      `got ${tools.length}`,
    );

    assert(
      'compass_list_features available',
      tools.some((t) => t.name === 'compass_list_features'),
    );
    assert(
      'compass_generate_handoff_brief available',
      tools.some((t) => t.name === 'compass_generate_handoff_brief'),
    );
    assert(
      'compass_get_client_activity available',
      tools.some((t) => t.name === 'compass_get_client_activity'),
    );

    // Server should have auto-registered the project from COMPASS_PROJECT_ROOT
    const listResult = await client.callTool('compass_list_features', {});
    const text = listResult.content[0]?.text ?? '{}';
    const parsed = JSON.parse(text) as {
      project: { name: string; active_phase: string };
      summary: { total: number };
    };
    assert(
      'auto-registered project name = "project"',
      parsed.project.name === 'project',
      parsed.project.name,
    );
    assert(
      'default active_phase = v1',
      parsed.project.active_phase === 'v1',
      parsed.project.active_phase,
    );
    assert(
      'empty tree on a brand-new project',
      parsed.summary.total === 0,
      String(parsed.summary.total),
    );

    // get_client_activity should reflect our client_type env
    const activityRes = await client.callTool('compass_get_client_activity', {});
    const aText = activityRes.content[0]?.text ?? '{}';
    const activity = JSON.parse(aText) as {
      clients: Array<{ client_type: string; run_count: number }>;
    };
    // No runs yet, but the call itself must succeed
    assert(
      'client_activity call succeeds (empty result)',
      Array.isArray(activity.clients) && activity.clients.length === 0,
      `clients=${activity.clients?.length}`,
    );

    const failed = checks.filter((c) => !c.ok);
    console.log(
      `\n[integration] ${checks.length - failed.length}/${checks.length} checks passed`,
    );
    if (failed.length > 0) {
      console.error('[integration] FAIL');
      process.exitCode = 1;
    } else {
      console.log(
        '[integration] PASS — bin/compass-mcp ready for real IDE clients',
      );
    }
  } finally {
    client.close();
    await sleep(150);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[integration] fatal:', err);
  process.exit(1);
});
