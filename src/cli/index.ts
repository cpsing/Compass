import { captureCommitCli } from "./capture-commit.ts";
import { installHookCli } from "./install-hook.ts";
import { statusCli } from "./status.ts";

const USAGE = `compass-cli — Compass command line interface

Usage:
  compass-cli status         [--runs N] [--calls N]
  compass-cli capture-commit --project-root <path> --sha <sha>
  compass-cli install-hook   [--project-root <path>] [--cli-bin <cmd>] [--force]
  compass-cli --help

The status subcommand reads COMPASS_PROJECT_ROOT (or cwd) to pick a project.
`;

function main(): void {
  const [, , subcommand, ...rest] = process.argv;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    process.stdout.write(USAGE);
    return;
  }

  switch (subcommand) {
    case "status":
      statusCli(rest);
      return;
    case "capture-commit":
      captureCommitCli(rest);
      return;
    case "install-hook":
      installHookCli(rest);
      return;
    default:
      console.error(`unknown subcommand: ${subcommand}\n`);
      process.stderr.write(USAGE);
      process.exit(2);
  }
}

main();
