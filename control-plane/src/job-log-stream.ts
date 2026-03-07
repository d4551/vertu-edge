import { sse } from "elysia";
import type { CapabilityJobState } from "../../contracts/flow-contracts";
import { encodeJobEventCursor } from "./db";
import type { LogStreamFormat } from "./http-helpers";
import { esc } from "./renderers";
import { SSE_POLL_INTERVAL_MS } from "./config";
import { t } from "./i18n";

/** Normalized log severity levels supported by the control-plane UI. */
export type LogEventLevel = "debug" | "info" | "warn" | "error";

/** Stored job-log record returned by persistence adapters before UI normalization. */
export type JobLogEventRecord = {
  id: string;
  level: string;
  message: string;
  commandIndex: number | null;
  createdAt: string;
};

/** Normalized job-log payload used for HTML and SSE transport. */
export type JobLogEventPayload = {
  id: string;
  level: LogEventLevel;
  message: string;
  commandIndex: number | null;
  createdAt: string;
};

/** Input surface for the shared job-log SSE streaming helper. */
export type LogStreamInput = {
  format: LogStreamFormat;
  tail: boolean;
  initialCursor: string | null;
  request: Request;
  listEvents: (jobId: string, afterCursor?: string | null) => ReadonlyArray<JobLogEventRecord>;
  readStatus: (jobId: string) => CapabilityJobState | undefined;
  jobId: string;
};

/** Normalize untrusted log-level strings into the supported UI enum. */
export function normalizeLogEventLevel(value: string): LogEventLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return "info";
}

/** Determine whether a capability/job status has reached a terminal state. */
export function isTerminalJobState(status: CapabilityJobState | undefined): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/** Map normalized log levels to DaisyUI badge styles. */
export function logLevelBadgeClass(level: LogEventLevel): string {
  if (level === "error") return "badge-error";
  if (level === "warn") return "badge-warning";
  if (level === "debug") return "badge-ghost";
  return "badge-info";
}

/** Render one job-log row for SSE-driven HTML log tables. */
export function renderLogEventHtmlRow(event: JobLogEventPayload): string {
  const commandIndexLabel = event.commandIndex === null ? "-" : String(event.commandIndex + 1);
  return `<tr>
    <td class="font-mono text-xs">
      <div class="flex flex-wrap items-center gap-2">
        <span class="badge badge-xs ${logLevelBadgeClass(event.level)}">${esc(event.level.toUpperCase())}</span>
        <span class="opacity-70">${esc(event.createdAt)}</span>
        <span class="badge badge-ghost badge-xs">#${esc(commandIndexLabel)}</span>
        <span>${esc(event.message)}</span>
      </div>
    </td>
  </tr>`;
}

/** Render a live DaisyUI log table wired for HTMX SSE updates. */
export function renderLiveLogTable(logRegionId: string, connectPath: string): string {
  return `<div class="mt-3" role="region" aria-label="${esc(t("api.logs_sse"))}">
    <h4 class="font-semibold text-sm mb-1">${t("api.logs_sse")}</h4>
    <div class="overflow-x-auto rounded-lg border border-base-content/10 max-h-56">
      <table class="table table-xs table-pin-rows">
        <thead><tr><th>${t("api.logs_sse")}</th></tr></thead>
        <tbody
          id="${esc(logRegionId)}"
          role="log"
          aria-live="polite"
          hx-ext="sse"
          sse-connect="${esc(connectPath)}"
          sse-swap="debug,info,warn,error"
          hx-swap="beforeend show:bottom">
          <tr><td class="text-xs opacity-60">${esc(`${t("api.status_running")}...`)}</td></tr>
        </tbody>
      </table>
    </div>
  </div>`;
}

/** Stream normalized flow/app/workflow log events as SSE with optional tail polling. */
export async function* streamJobLogs({
  format,
  tail,
  initialCursor,
  request,
  listEvents,
  readStatus,
  jobId,
}: LogStreamInput): AsyncGenerator<ReturnType<typeof sse>, void, unknown> {
  let cursor = initialCursor;
  do {
    const events = listEvents(jobId, cursor);
    for (const event of events) {
      cursor = encodeJobEventCursor(event);
      const normalizedEvent: JobLogEventPayload = {
        id: event.id,
        level: normalizeLogEventLevel(event.level),
        message: event.message,
        commandIndex: event.commandIndex,
        createdAt: event.createdAt,
      };
      yield sse({
        event: normalizedEvent.level,
        id: normalizedEvent.id,
        data: format === "html" ? renderLogEventHtmlRow(normalizedEvent) : normalizedEvent,
      });
    }
    if (!tail) {
      break;
    }
    const status = readStatus(jobId);
    if (isTerminalJobState(status)) {
      break;
    }
    await Bun.sleep(SSE_POLL_INTERVAL_MS);
  } while (!request.signal.aborted);
}
