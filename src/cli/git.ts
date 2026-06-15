import { execFileSync } from "node:child_process";

export interface CommitInfo {
  sha: string;
  message: string;
  files_changed: string[];
  lines_added: number;
  lines_deleted: number;
  author: string;
  branch: string;
  committed_at: number;
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function readCommitInfo(rootPath: string, sha: string): CommitInfo {
  const message = git(["log", "-1", "--pretty=%B", sha], rootPath);
  const author = git(["log", "-1", "--pretty=%ae", sha], rootPath);
  const committedSec = Number(
    git(["log", "-1", "--pretty=%ct", sha], rootPath),
  );
  const branch = safeBranch(rootPath);
  const numstat = git(["show", "--numstat", "--pretty=format:", sha], rootPath);

  let linesAdded = 0;
  let linesDeleted = 0;
  const files: string[] = [];
  for (const line of numstat.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 3) continue;
    const [addedRaw, deletedRaw, path] = parts;
    linesAdded += addedRaw === "-" ? 0 : Number(addedRaw);
    linesDeleted += deletedRaw === "-" ? 0 : Number(deletedRaw);
    if (path) files.push(path);
  }

  return {
    sha,
    message,
    files_changed: files,
    lines_added: linesAdded,
    lines_deleted: linesDeleted,
    author,
    branch,
    committed_at: committedSec * 1000,
  };
}

function safeBranch(rootPath: string): string {
  try {
    return git(["rev-parse", "--abbrev-ref", "HEAD"], rootPath);
  } catch {
    return "";
  }
}

export function isGitRepo(rootPath: string): boolean {
  try {
    git(["rev-parse", "--git-dir"], rootPath);
    return true;
  } catch {
    return false;
  }
}

export function gitTopLevel(rootPath: string): string {
  return git(["rev-parse", "--show-toplevel"], rootPath);
}
