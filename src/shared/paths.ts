import { homedir } from "node:os";
import { resolve, join } from "node:path";

function defaultDataDir(): string {
  return join(homedir(), ".compass");
}

export function dataDir(): string {
  return process.env.COMPASS_DATA_DIR ?? defaultDataDir();
}

export function dbPath(): string {
  return resolve(dataDir(), "db.sqlite");
}

export function homeDir(): string {
  return homedir();
}
