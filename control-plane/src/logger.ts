/** Minimal structured logger for control-plane. Routes to stdout with JSON output. */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogMetaValue = string | number | boolean | null | LogMeta | LogMetaValue[];
export type LogMeta = { [key: string]: LogMetaValue };

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: LogMetaValue;
}

function formatEntry(level: LogLevel, message: string, meta?: LogMeta): string {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };
  return JSON.stringify(entry);
}

function writeLog(level: LogLevel, message: string, meta?: LogMeta): void {
  const line = formatEntry(level, message, meta);
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const logger = {
  debug: (message: string, meta?: LogMeta) => writeLog("debug", message, meta),
  info: (message: string, meta?: LogMeta) => writeLog("info", message, meta),
  warn: (message: string, meta?: LogMeta) => writeLog("warn", message, meta),
  error: (message: string, meta?: LogMeta) => writeLog("error", message, meta),
};
