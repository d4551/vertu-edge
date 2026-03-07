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
  format: t.Optional(t.Union([t.Literal("json"), t.Literal("html")])),
  tail: t.Optional(t.Union([t.Boolean(), t.Number(), t.String()])),
});

/** Shared flow-target schema used by validation and execution endpoints. */
export const flowTargetBodySchema = t.Optional(
  t.Union([
    t.Literal("android"),
    t.Literal("ios"),
    t.Literal("osx"),
    t.Literal("windows"),
    t.Literal("linux"),
  ]),
);

/** Shared flow request schema used by flow execution and validation endpoints. */
export const flowRequestBodySchema = t.Object({
  yaml: t.String(),
  target: flowTargetBodySchema,
  maxAttempts: t.Optional(t.Union([t.Number(), t.String()])),
  commandTimeoutMs: t.Optional(t.Union([t.Number(), t.String()])),
  retryDelayMs: t.Optional(t.Union([t.Number(), t.String()])),
  correlationId: t.Optional(t.String()),
});

/** Shared AI workflow mode query schema for HTMX fragment routes. */
export const aiWorkflowModeQuerySchema = t.Object({
  mode: t.Optional(t.Union([
    t.Literal("chat"),
    t.Literal("typography"),
    t.Literal("presentation"),
    t.Literal("social"),
    t.Literal("image"),
    t.Literal("flow_generation"),
  ])),
});

/** Shared AI workflow capability query schema for provider/model-aware state rendering. */
export const aiWorkflowCapabilitiesQuerySchema = t.Object({
  mode: t.Optional(t.Union([
    t.Literal("chat"),
    t.Literal("typography"),
    t.Literal("presentation"),
    t.Literal("social"),
    t.Literal("image"),
    t.Literal("flow_generation"),
  ])),
  provider: t.Optional(t.String()),
  model: t.Optional(t.String()),
});

/** Shared AI workflow request schema for HTMX execution routes. */
export const aiWorkflowRequestBodySchema = t.Object({
  mode: t.Union([
    t.Literal("chat"),
    t.Literal("typography"),
    t.Literal("presentation"),
    t.Literal("social"),
    t.Literal("image"),
    t.Literal("flow_generation"),
  ]),
  message: t.String(),
  provider: t.Optional(t.String()),
  model: t.Optional(t.String()),
  apiKey: t.Optional(t.String()),
  baseUrl: t.Optional(t.String()),
  correlationId: t.Optional(t.String()),
  conversationId: t.Optional(t.String()),
  textOptions: t.Optional(t.Object({
    audience: t.Optional(t.String()),
    tone: t.Optional(t.String()),
    format: t.Optional(t.String()),
    constraints: t.Optional(t.String()),
  })),
  imageOptions: t.Optional(t.Object({
    size: t.Optional(t.String()),
    seed: t.Optional(t.Union([t.Number(), t.String()])),
    steps: t.Optional(t.Union([t.Number(), t.String()])),
    stylePreset: t.Optional(t.String()),
  })),
});

/** Shared provider validation body schema for connectivity checks. */
export const providerValidationBodySchema = t.Object({
  connectivity: t.Optional(t.Union([t.Boolean(), t.Number(), t.String()])),
});

/** Shared provider credential body schema for save/test operations. */
export const providerCredentialBodySchema = t.Object({
  provider: t.String(),
  apiKey: t.Optional(t.String()),
  baseUrl: t.Optional(t.String()),
});

/** Shared provider identifier body schema for delete operations. */
export const providerDeleteBodySchema = t.Object({
  provider: t.String(),
});

/** Shared user preference body schema for HTMX preference updates. */
export const preferenceBodySchema = t.Object({
  theme: t.Optional(t.String()),
  defaultModel: t.Optional(t.String()),
  locale: t.Optional(t.String()),
});

/** Shared UCP discovery query schema for HTML/JSON discovery responses. */
export const ucpDiscoverQuerySchema = t.Object({
  url: t.Optional(t.String()),
  format: t.Optional(t.String()),
});

/** Request pagination schema for list endpoints. */
export const listFilterSchema = t.Object({
  status: t.Optional(t.String()),
  q: t.Optional(t.String()),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
});

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
