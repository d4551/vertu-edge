/** Shared subprocess helpers for canonical flow-kit commands. */

/** Structured subprocess outcome captured by the orchestration layer. */
export interface CommandResult {
  /** Full command argv passed to Bun.spawn. */
  readonly command: readonly string[];
  /** Working directory used for process execution. */
  readonly cwd: string;
  /** Process stdout text. */
  readonly stdout: string;
  /** Process stderr text. */
  readonly stderr: string;
  /** Exit code reported by the process. */
  readonly exitCode: number;
  /** Whether the process completed successfully. */
  readonly success: boolean;
}

/** Supported stdin payloads for Bun-native subprocess execution. */
export type CommandStdin =
  | Blob
  | ReadableStream<Uint8Array>
  | Request
  | Response;

/** Spawn-time options supported by the canonical subprocess owner. */
export interface RunCommandOptions {
  /** Optional working directory override. */
  readonly cwd?: string;
  /** Optional environment overrides merged onto the current process environment. */
  readonly env?: Record<string, string | undefined>;
  /** Optional stdin payload piped into the subprocess. */
  readonly stdin?: CommandStdin;
  /** Optional subprocess timeout in milliseconds. */
  readonly timeout?: number;
}

function buildProcessEnv(
  env: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      merged[key] = value;
    }
  }
  if (!env) {
    return merged;
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      merged[key] = value;
    }
  }
  return merged;
}

/** Execute a subprocess with deterministic stdout/stderr capture. */
export async function runCommand(
  command: readonly string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const proc = Bun.spawn(Array.from(command), {
    cwd: options.cwd ?? process.cwd(),
    env: buildProcessEnv(options.env),
    ...(options.stdin ? { stdin: options.stdin } : {}),
    stdout: "pipe",
    stderr: "pipe",
    ...(typeof options.timeout === "number" ? { timeout: options.timeout } : {}),
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return {
    command,
    cwd: options.cwd ?? process.cwd(),
    stdout,
    stderr,
    exitCode,
    success: exitCode === 0,
  };
}
