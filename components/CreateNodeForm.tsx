"use client";

import { useState, useTransition } from "react";
import { createNodeAction } from "../app/actions/nodes.ts";

interface Props {
  projectId: string;
  kind: "module" | "feature" | "task";
  parentId?: string;
  parentTitle?: string;
  compact?: boolean;
}

export function CreateNodeForm({
  projectId,
  kind,
  parentId,
  parentTitle,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    setError(null);
    startTransition(async () => {
      const result = await createNodeAction({
        project_id: projectId,
        parent_id: parentId,
        kind,
        title,
        description: description || undefined,
      });
      if (!result.ok) {
        setError(result.error ?? "failed");
      } else {
        setTitle("");
        setDescription("");
        setOpen(false);
      }
    });
  };

  const promptLabel =
    kind === "module"
      ? "+ Add module"
      : kind === "feature"
        ? "+ Add feature"
        : "+ Add task";
  const titlePlaceholder =
    kind === "module"
      ? "e.g. Auth, Billing, Analytics"
      : kind === "feature"
        ? "e.g. Email login"
        : "e.g. Build /auth/login endpoint";

  if (!open) {
    const childLabel =
      kind === "feature"
        ? "+ feature"
        : kind === "task"
          ? "+ task"
          : "+ module";
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        title={
          parentTitle ? `Add ${kind} under "${parentTitle}"` : `Add ${kind}`
        }
        className={
          compact
            ? "text-[10px] px-1.5 py-0.5 rounded border border-gray-700/60 text-gray-500 hover:text-gray-200 hover:border-gray-500 hover:bg-gray-800/60 mono"
            : "text-xs px-2 py-1 rounded border border-dashed border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500"
        }
      >
        {compact
          ? childLabel
          : `${promptLabel}${parentTitle ? ` under "${parentTitle}"` : ""}`}
      </button>
    );
  }

  return (
    <div
      className={`rounded-lg border border-gray-700 bg-gray-900 p-3 space-y-2 ${
        compact ? "basis-full mt-2 w-full max-w-2xl" : "max-w-xl"
      }`}
    >
      <div className="text-xs text-gray-400">
        New {kind}
        {parentTitle ? ` under "${parentTitle}"` : ""}
      </div>
      <input
        type="text"
        autoFocus
        value={title}
        placeholder={titlePlaceholder}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
        disabled={pending}
        className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-600"
      />
      <textarea
        value={description}
        placeholder="Description (optional)"
        rows={2}
        onChange={(e) => setDescription(e.target.value)}
        disabled={pending}
        className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-600 resize-none"
      />
      {error && <div className="text-xs text-red-400">{error}</div>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || title.trim().length === 0}
          className="text-xs px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded text-gray-400 hover:text-gray-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
