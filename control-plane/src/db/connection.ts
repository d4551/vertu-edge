import { Database } from "bun:sqlite";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Resolve the SQLite database file path.
 * Priority: VERTU_DB_PATH env → default location relative to project root.
 * For compiled binaries, set VERTU_DB_PATH to control where the DB lives.
 */
export function resolveDbPath(): string {
  const envPath = process.env.VERTU_DB_PATH?.trim();
  if (envPath && envPath.length > 0) return envPath;
  // Fallback: relative to source for dev, or $HOME/.vertu/vertu.sqlite for compiled
  if (typeof import.meta.dir === "string" && import.meta.dir.length > 0) {
    return join(import.meta.dir, "..", "..", "vertu.sqlite");
  }
  return join(homedir(), ".vertu", "vertu.sqlite");
}

const DB_PATH = resolveDbPath();

/** Shared SQLite database handle for control-plane state. */
export const sqlite = new Database(DB_PATH, { create: true, strict: true });

// Enable WAL mode for concurrent read performance (critical for SSE streaming + writes).
sqlite.run("PRAGMA journal_mode = WAL;");
// Enforce foreign key constraints at the connection level.
sqlite.run("PRAGMA foreign_keys = ON;");
