import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProject } from '../../../../../../lib/projects.ts';
import { getNode } from '../../../../../../lib/db-facade.ts';
import { getHandoffMarkdown } from '../../../../../../app/actions/handoff.ts';
import { CopyButton } from '../../../../../../components/CopyButton.tsx';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ projectId: string; nodeId: string }>;
}

export default async function HandoffPage({ params }: PageProps) {
  const { projectId, nodeId } = await params;
  const project = getProject(projectId);
  const node = getNode(nodeId);
  if (!project || !node || node.project_id !== project.id) notFound();

  const result = await getHandoffMarkdown(project.id, node.id, 'dashboard');
  const markdown = result.markdown ?? '(failed to generate)';

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/p/${project.id}/nodes/${node.id}`}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          ← back to {node.title}
        </Link>
        <div className="flex items-center justify-between gap-4 mt-2 flex-wrap">
          <h1 className="text-2xl font-semibold">Handoff brief</h1>
          <CopyButton text={markdown} />
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Paste into another AI client to continue this work. Server-generated,
          consistent format across sessions.
        </p>
      </div>

      <pre className="text-sm text-gray-200 bg-gray-950 border border-gray-800 rounded-lg p-5 whitespace-pre-wrap font-mono leading-relaxed">
        {markdown}
      </pre>
    </div>
  );
}
