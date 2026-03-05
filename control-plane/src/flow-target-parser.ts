import type { FlowRunTarget } from "../../contracts/flow-contracts";
import { DEFAULT_FLOW_TARGET } from "./config";

type FlowTargetInput = string | number | boolean | null | undefined;

const FLOW_TARGET_OPTIONS = [
  "android",
  "ios",
  "osx",
  "windows",
  "linux",
] as const;
const FLOW_TARGET_SET = new Set<string>(FLOW_TARGET_OPTIONS);

/** Parse request-provided target values into the canonical flow target enum. */
export function parseFlowTarget(value: FlowTargetInput): FlowRunTarget {
  const raw = parseOptionalTrimmedString(value)?.toLowerCase();
  if (!raw || !isFlowRunTarget(raw)) {
    return DEFAULT_FLOW_TARGET;
  }
  return raw;
}

function isFlowRunTarget(value: string): value is FlowRunTarget {
  return FLOW_TARGET_SET.has(value);
}

function parseOptionalTrimmedString(value: FlowTargetInput): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
