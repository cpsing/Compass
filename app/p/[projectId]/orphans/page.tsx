import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProject } from '../../../../lib/projects.ts';
import { listProjectNodes } from '../../../../lib/db-facade.ts';
import { listUnattributed } from '../../../../src/db/events.ts';
import {
  groupIntoWindows,
  DEFAULT_WINDOW_GAP_MS,
} from '../../../../src/reconciler/window.ts';
import type { ActivityEvent } from '../../../../src/db/events.ts';
import {
  OrphansSelector,
  type OrphanEvent,
  type OrphanGroup,
  type NodeOption,
} from '../../../../components/OrphansSelector.tsx';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ projectId: string }>;
}

interface CommitPayload {
  sha?: string;
  message?: string;
  files_changed?: string[];
  lines_added?: number;
  lines_deleted?: number;
  branch?: string;
}

interface FsWatchPayload {
  files?: string[];
  change_types?: string[];
  window_start?: number;
  window_end?: number;
}

interface McpPayload {
  tool_name?: string;
  client_type?: string;
  args?: Record<string, unknown>;
}

function summariseEvent(evt: ActivityEvent): OrphanEvent {
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(evt.payload);
  } catch {
    parsed = {};
  }
  if (evt.source === 'commit') {
    const p = parsed as CommitPayload;
    return {
      id: evt.id,
      source: 'commit',
      event_type: evt.event_type,
      occurred_at: evt.occurred_at,
      preview: `commit ${(p.sha ?? '').slice(0, 7)} · ${(p.message ?? '').split('\n')[0]?.trim() ?? ''}`,
      detail: JSON.stringify(p, null, 2),
      files: p.files_changed ?? [],
    };
  }
  if (evt.source === 'fs_watch') {
    const p = parsed as FsWatchPayload;
    const files = p.files ?? [];
    return {
      id: evt.id,
      source: 'fs_watch',
      event_type: evt.event_type,
      occurred_at: evt.occurred_at,
      preview: `${files.length} file change(s)`,
      detail: JSON.stringify(p, null, 2),
      files,
    };
  }
  const p = parsed as McpPayload;
  return {
    id: evt.id,
    source: 'mcp_call',
    event_type: evt.event_type,
    occurred_at: evt.occurred_at,
    preview: `${p.tool_name ?? 'unknown_tool'} from ${p.client_type ?? 'unknown'}`,
    detail: JSON.stringify(p, null, 2),
    files: [],
  };
}

export default async function OrphansPage({ params }: PageProps) {
  const { projectId } = await params;
  const project = getProject(projectId);
  if (!project) notFound();

  const events = listUnattributed(project.id);
  const windows = groupIntoWindows(events, DEFAULT_WINDOW_GAP_MS);
  const groups: OrphanGroup[] = windows.map((w) => ({
    start: w.start,
    end: w.end,
    events: w.events.map(summariseEvent),
  }));

  const allNodes = listProjectNodes(project.id);
  const nodeOptions: NodeOption[] = allNodes
    .filter((n) => n.status !== 'archived')
    .map((n) => ({
      id: n.id,
      label: n.title,
      kind: n.kind,
      status: n.status,
    }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/p/${project.id}`}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          ← back to {project.name}
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Unattributed activity</h1>
        <p className="text-sm text-gray-500 mt-1">
          Events the reconciler could not auto-link to a feature node. Select a
          group or individual events and assign them to the right feature to
          create a reconciled AI run.
        </p>
      </div>

      <OrphansSelector
        projectId={project.id}
        groups={groups}
        nodeOptions={nodeOptions}
      />
    </div>
  );
}
