import { t } from "elysia";
import type { ApiEnvelope, ControlPlaneState, FlowRuntimeError } from "../../../contracts/flow-contracts";

/** Supported control-plane command lifecycle states. */
export type CommandState = ControlPlaneState;

/** Typed schema for command lifecycle state transitions. */
export const commandStateSchema = t.Union([
  t.Literal("idle"),
  t.Literal("loading"),
  t.Literal("success"),
  t.Literal("empty"),
  t.Literal("error-retryable"),
  t.Literal("error-non-retryable"),
  t.Literal("unauthorized"),
]);

/** Surface name for a command-style operation. */
export type CommandSurface =
  | "model_pull"
  | "app_build"
  | "flow_run"
  | "flow_validation"
  | "flow_automation_validation"
  | "provider_validation"
  | "provider_key"
  | "provider_models";

/** Route command envelope used by async systems and tests. */
export interface CommandEnvelope<TData = JsonLike, TError = FlowRuntimeError> extends ApiEnvelope<TData, TError> {
  /** Canonical route used to emit this payload. */
  route: string;
  /** Runtime lifecycle state. */
  state: CommandState;
  /** Optional command identifier for polling and logs. */
  jobId?: string;
  /** Command surface for observability. */
  surface?: CommandSurface;
}

/** Strongly typed command envelope payload for model pull and app-build routes. */
export type CommandPayload<TData = JsonLike> = ApiEnvelope<TData, FlowRuntimeError>;

/** Strict JSON-like payload type for command contracts. */
type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike };
