import { t } from "elysia";
import type {
  ApiEnvelope,
  ControlPlaneState,
  FlowRuntimeError,
  AppBuildEnvelope,
  ModelPullEnvelope,
} from "../../../contracts/flow-contracts";

/** Canonical state machine used by all HTTP and UI envelopes. */
export const controlPlaneStateSchema = t.Union([
  t.Literal("idle"),
  t.Literal("loading"),
  t.Literal("success"),
  t.Literal("empty"),
  t.Literal("error-retryable"),
  t.Literal("error-non-retryable"),
  t.Literal("unauthorized"),
]);

/** Shared command-surface schema used by admin and job endpoints. */
export const commandLogQuerySchema = t.Object({
  cursor: t.Optional(t.String()),
  after: t.Optional(t.String()),
  format: t.Optional(t.Union([t.Literal("json"), t.Literal("html")])),
  tail: t.Optional(t.Union([t.Boolean(), t.Number(), t.String()])),
});

/** Request pagination schema for list endpoints. */
export const listFilterSchema = t.Object({
  status: t.Optional(t.String()),
  q: t.Optional(t.String()),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
});

/** List pagination shape for list endpoints. */
export interface ListPagination {
  /** Cursor token for stable pagination. */
  cursor?: string;
  /** Legacy page-based pagination fallback. */
  page?: number;
  /** Max rows returned by endpoint. */
  pageSize?: number;
}

/** Command and envelope route names used by pluginized control-plane modules. */
export type CommandRoute =
  | "/api/models/pull"
  | "/api/apps/build"
  | "/api/flows/runs"
  | "/api/flows/run"
  | "/api/flows/trigger";

/** Generic command-style envelope for job-oriented endpoints. */
export interface CommandEnvelope<TData = JsonLike, TError = FlowRuntimeError> extends ApiEnvelope<TData, TError> {
  /** Route used to emit this envelope. */
  route: CommandRoute;
  /** Optional command identifier used by async routes. */
  jobId?: string;
  /** Human-readable mismatch lines for deterministic UI states. */
  mismatches: string[];
}

/** Generic paged envelope for list endpoints. */
export interface PagedEnvelope<TItem = JsonLike, TError = FlowRuntimeError> extends ApiEnvelope<TItem[], TError> {
  /** Maximum number of rows included in this page. */
  pageSize: number;
  /** Next cursor token for pagination continuation. */
  nextCursor?: string;
}

/** Model pull envelope payload alias for contract tests and service boundaries. */
export type ModelPullEnvelopePayload = ApiEnvelope<ModelPullEnvelope["data"], FlowRuntimeError>;

/** App-build envelope payload alias for contract tests and service boundaries. */
export type AppBuildEnvelopePayload = ApiEnvelope<AppBuildEnvelope["data"], FlowRuntimeError>;

/** Route-level contract for command surfaces. */
export interface CommandContract<TData = JsonLike, TError = FlowRuntimeError> {
  /** Runtime state schema for command handlers. */
  state: ControlPlaneState;
  /** Route constant to prevent drift. */
  route: CommandRoute;
  /** Payload for command responses. */
  data: TData;
  /** Structured error details for non-success states. */
  error?: TError;
  /** Human-readable mismatch metadata list. */
  mismatches: readonly string[];
}

/** Strict JSON-like payload type for route contracts. */
type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike };
