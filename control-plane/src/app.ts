import { join } from "node:path";
import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import {
  createAppBuildPlugin,
  createAiProviderManagementPlugin,
  createAiWorkflowPlugin,
  createDeviceReadinessPlugin,
  createFlowRoutesPlugin,
  createModelManagementPlugin,
  createPreferencesPlugin,
  createUcpDiscoveryPlugin,
  dashboardPlugin,
  healthPlugin,
} from "./plugins";
import { controlPlaneAuthGuard } from "./middleware/auth";
import { CONTROL_PLANE_ERROR_TYPES, handleControlPlaneError } from "./middleware/error-handler";
import { DEFAULT_LOCALE, isSupportedLocale, setActiveLocale, t as tStr, type Locale } from "./i18n";
import { getPreference, setPreference, listCapabilityJobs, listConversations, deleteConversation, listMessages, getModelAssignment, setModelAssignment, clearModelAssignment, listSavedFlows, createSavedFlow, getSavedFlow, updateSavedFlow, deleteSavedFlow, sqlite } from "./db";
import { parseMaestroYaml } from "./yaml-parser";
import { captureResult, normalizeFailureMessage } from "../../shared/failure";
import {
  SUPPORTED_THEMES,
} from "./config";
import {
  streamJobLogs,
  type JobLogEventPayload,
} from "./job-log-stream";
import {
  toCapabilityError,
} from "./capability-errors";
import {
  buildModelSelectOptions,
  parseAiWorkflowModeSelection,
  renderAiWorkflowCapabilitiesState,
  renderAiWorkflowFormFields,
  renderAiWorkflowJobState,
  renderAiWorkflowRunState,
  renderModelSelectionOptions,
  renderProviderValidationState,
  sanitizeApiErrorForDisplay,
} from "./ai-renderers";
import {
  renderFlowRunJobState,
} from "./flow-renderers";
import {
  isSupportedHttpUrl,
  isValidModelIdentifier,
  parseAppBuildRequestBody,
  parseFlowRunRequestBody,
  parseModelPullRequestBody,
  parseProviderValidationBody,
} from "./request-parsers";
import {
  renderAppBuildState,
  renderModelPullState,
  renderModelSearchState,
} from "./model-build-renderers";
import { renderDeviceAiReadinessState } from "./device-readiness-renderers";
import {
  PUBLIC_ASSET_ROUTE_PREFIX,
} from "./runtime-constants";
import {
  renderFlowCapabilityMatrixHttpRoute,
  runFlowHttpRoute,
  validateFlowAutomationHttpRoute,
  validateFlowYamlHttpRoute,
} from "./flow-http-handlers";
import { validateProviders } from "./provider-validation";
import { logger } from "./logger";
import {
  type AppBuildRequest,
  type AppBuildEnvelope,
  type FlowRunResult,
  type FlowRunRequest,
  type FlowRunJobEnvelope,
  type AiWorkflowRequest,
  type AiWorkflowJobEnvelope,
  type AiWorkflowCapabilityEnvelope,
  type ModelPullEnvelope,
  type ModelPullRequest,
  type DeviceAiReadinessEnvelope,
} from "../../contracts/flow-contracts";
import { RPADriver } from "./flow-engine";
import {
  cancelModelPullJob,
  deleteModel,
  getModelInventory,
  getModelPullJobEnvelope,
  getModelPullJobLogEvents,
  resumeModelPullJob,
  startModelPullJob,
} from "./model-manager";
import type { LocalModelRow } from "./db";
import {
  cancelAppBuildJob,
  getAppBuildJobEnvelope,
  getAppBuildJobLogEvents,
  resumeAppBuildJob,
  startAppBuildJob,
} from "./app-builds";
import {
  cancelFlowRunJob,
  getFlowRunJobEnvelope,
  getFlowRunLogEvents,
  pauseFlowRunJob,
  replayFlowRunStep,
  resumeFlowRunJob,
  startFlowRunJob,
} from "./flow-runs";
import {
  cancelAiWorkflowJob,
  getAiWorkflowCapabilityEnvelope,
  getAiWorkflowJobEnvelope,
  getAiWorkflowJobLogEvents,
  parseAiWorkflowRequestBody,
  startAiWorkflowJob,
} from "./ai-workflows/orchestrator";
import { resolveDeviceAiReadinessEnvelope } from "./device-ai-readiness";

/**
 * Dependency surface for model/build capability routes.
 * Injectable in tests to avoid external runtime side effects.
 */
export interface ControlPlaneServices {
  /** Start model pull execution and return initial envelope. */
  readonly startModelPullJob: (request: ModelPullRequest, requestedBy?: string) => Promise<ModelPullEnvelope>;
  /** Read model pull job status by identifier. */
  readonly getModelPullJobEnvelope: (jobId: string) => ModelPullEnvelope;
  /** Cancel running model pull job. */
  readonly cancelModelPullJob?: (jobId: string) => ModelPullEnvelope;
  /** Resume model pull job as deterministic requeue. */
  readonly resumeModelPullJob?: (jobId: string) => ModelPullEnvelope;
  /** List model pull log events for polling/SSE. */
  readonly getModelPullJobLogEvents?: (jobId: string, afterCursor?: string | null) => ReadonlyArray<JobLogEventPayload>;
  /** Start app build execution and return initial envelope. */
  readonly startAppBuildJob: (request: AppBuildRequest, requestedBy?: string) => Promise<AppBuildEnvelope>;
  /** Read app build job status by identifier. */
  readonly getAppBuildJobEnvelope: (jobId: string) => AppBuildEnvelope;
  /** Cancel running app build job. */
  readonly cancelAppBuildJob?: (jobId: string) => AppBuildEnvelope;
  /** Resume app build job as deterministic requeue. */
  readonly resumeAppBuildJob?: (jobId: string) => AppBuildEnvelope;
  /** List app build log events for polling/SSE. */
  readonly getAppBuildJobLogEvents?: (jobId: string, afterCursor?: string | null) => ReadonlyArray<JobLogEventPayload>;
  /** Execute flow payloads and return deterministic flow run artifacts. */
  readonly runFlow?: (request: FlowRunRequest) => Promise<FlowRunResult>;
  /** Start async flow-run job. */
  readonly startFlowRunJob?: (request: FlowRunRequest, requestedBy?: string) => FlowRunJobEnvelope;
  /** Poll async flow-run job by id. */
  readonly getFlowRunJobEnvelope?: (runId: string) => FlowRunJobEnvelope;
  /** Cancel async flow-run job. */
  readonly cancelFlowRunJob?: (runId: string) => FlowRunJobEnvelope;
  /** Pause async flow-run job. */
  readonly pauseFlowRunJob?: (runId: string) => FlowRunJobEnvelope;
  /** Resume async flow-run job. */
  readonly resumeFlowRunJob?: (runId: string) => FlowRunJobEnvelope;
  /** Replay failed step in async flow-run job. */
  readonly replayFlowRunStep?: (runId: string, commandIndex: number) => FlowRunJobEnvelope;
  /** List run logs for polling/SSE. */
  readonly getFlowRunLogEvents?: (runId: string, afterCursor?: string | null) => ReadonlyArray<JobLogEventPayload>;
  /** Start async creative workflow job. */
  readonly startAiWorkflowJob?: (request: AiWorkflowRequest, requestedBy?: string) => AiWorkflowJobEnvelope;
  /** Poll creative workflow job by id. */
  readonly getAiWorkflowJobEnvelope?: (jobId: string) => AiWorkflowJobEnvelope;
  /** Cancel creative workflow job. */
  readonly cancelAiWorkflowJob?: (jobId: string) => AiWorkflowJobEnvelope;
  /** List creative workflow logs. */
  readonly getAiWorkflowJobLogEvents?: (jobId: string, afterCursor?: string | null) => ReadonlyArray<JobLogEventPayload>;
  /** Resolve local-first workflow capability matrix. */
  readonly getAiWorkflowCapabilityEnvelope?: (correlationId?: string) => Promise<AiWorkflowCapabilityEnvelope>;
  /** Resolve current device-AI readiness state for the dashboard. */
  readonly resolveDeviceAiReadinessEnvelope?: () => DeviceAiReadinessEnvelope;
  /** List all registered local models from the inventory. */
  readonly getModelInventory?: () => LocalModelRow[];
  /** Delete a model from the local inventory and runtime cache. */
  readonly deleteModel?: (modelId: string) => Promise<{ ok: boolean; reason?: string }>;
  /** List paginated model pull job history. */
  readonly listModelPullJobs?: (params: { limit: number; offset: number; status?: string }) => { jobs: ReadonlyArray<import("./db").CapabilityJobRecord>; total: number };
  /** List recent conversations for the chat panel. */
  readonly listConversations?: (limit: number, offset: number) => { conversations: import("./db").ConversationRow[]; total: number };
  /** Delete a conversation and its messages. */
  readonly deleteConversation?: (id: string) => boolean;
  /** Get all messages for a conversation. */
  readonly getConversationMessages?: (id: string) => import("./db").MessageRow[];
  /** Get persisted model assignment for a workflow mode. */
  readonly getModelAssignment?: (mode: string) => { provider: string; model: string } | null;
  /** Pin a model assignment for a workflow mode. */
  readonly setModelAssignment?: (mode: string, provider: string, model: string) => void;
  /** Clear the model assignment for a workflow mode. */
  readonly clearModelAssignment?: (mode: string) => void;
  /** List paginated saved flows. */
  readonly listSavedFlows?: (limit: number, offset: number) => { flows: import("./db").SavedFlowRow[]; total: number };
  /** Create a saved flow and return its id. */
  readonly createSavedFlow?: (params: { name: string; yaml: string; description?: string; tags?: string }) => string;
  /** Retrieve a saved flow by id. */
  readonly getSavedFlow?: (id: string) => import("./db").SavedFlowRow | null;
  /** Update a saved flow by id. */
  readonly updateSavedFlow?: (id: string, patch: Record<string, string | undefined>) => void;
  /** Delete a saved flow by id. */
  readonly deleteSavedFlow?: (id: string) => boolean;
}

/** Optional app-factory parameters for route dependency injection. */
export interface CreateControlPlaneAppOptions {
  /** Override runtime services used by model/build endpoints. */
  readonly services?: Partial<ControlPlaneServices>;
}

/** Build default service bindings used in production runtime. */
export function createDefaultControlPlaneServices(): ControlPlaneServices {
  return {
    startModelPullJob,
    getModelPullJobEnvelope,
    cancelModelPullJob,
    resumeModelPullJob,
    getModelPullJobLogEvents,
    startAppBuildJob,
    getAppBuildJobEnvelope,
    cancelAppBuildJob,
    resumeAppBuildJob,
    getAppBuildJobLogEvents,
    startFlowRunJob,
    getFlowRunJobEnvelope,
    cancelFlowRunJob,
    pauseFlowRunJob,
    resumeFlowRunJob,
    replayFlowRunStep,
    getFlowRunLogEvents,
    startAiWorkflowJob,
    getAiWorkflowJobEnvelope,
    cancelAiWorkflowJob,
    getAiWorkflowJobLogEvents,
    getAiWorkflowCapabilityEnvelope,
    resolveDeviceAiReadinessEnvelope,
    getModelInventory,
    deleteModel,
    listModelPullJobs: (params: { limit: number; offset: number; status?: string }) => {
      const statusFilter = params.status as import("../../contracts/flow-contracts").CapabilityJobState | undefined;
      return listCapabilityJobs({ kind: "model_pull", status: statusFilter, limit: params.limit, offset: params.offset });
    },
    runFlow: async (request: FlowRunRequest): Promise<FlowRunResult> => {
      const flow = parseMaestroYaml(request.yaml);
      const driver = new RPADriver();
      return driver.executeFlow(flow, {
        target: request.target,
        maxAttempts: request.maxAttempts,
        commandTimeoutMs: request.commandTimeoutMs,
        retryDelayMs: request.retryDelayMs,
      });
    },
    listConversations,
    deleteConversation,
    getConversationMessages: listMessages,
    getModelAssignment,
    setModelAssignment,
    clearModelAssignment,
    listSavedFlows,
    createSavedFlow,
    getSavedFlow,
    updateSavedFlow,
    deleteSavedFlow,
  };
}

const SUPPORTED_THEMES_SET = new Set<string>(SUPPORTED_THEMES);
const CONTROL_PLANE_PUBLIC_DIR = join(import.meta.dir, "..", "public");
const controlPlaneStaticAssetsPlugin = await staticPlugin({
  prefix: PUBLIC_ASSET_ROUTE_PREFIX,
  assets: CONTROL_PLANE_PUBLIC_DIR,
});

function isSupportedTheme(value: string): value is (typeof SUPPORTED_THEMES)[number] {
  return SUPPORTED_THEMES_SET.has(value);
}

/** Create the control-plane HTTP app without binding to a socket. */
export function createControlPlaneApp(options: CreateControlPlaneAppOptions = {}) {
  const services: ControlPlaneServices = {
    ...createDefaultControlPlaneServices(),
    ...options.services,
  };
  const syncActiveLocaleFromPreference = (): Locale => {
    const storedLocale = getPreference("locale");
    const locale = isSupportedLocale(storedLocale) ? storedLocale : DEFAULT_LOCALE;
    setActiveLocale(locale);
    return locale;
  };
  syncActiveLocaleFromPreference();

  return new Elysia()
    .error(CONTROL_PLANE_ERROR_TYPES)
    .derive(() => ({ requestId: crypto.randomUUID() }))
    .guard(controlPlaneAuthGuard, (app) => app
      .use(controlPlaneStaticAssetsPlugin)
      .use(healthPlugin)
      .use(dashboardPlugin)
      .use(createModelManagementPlugin({
        services,
        parseModelPullRequestBody,
        toCapabilityError,
        renderModelPullState,
        renderModelSearchState,
        translate: tStr,
      }))
      .use(createAppBuildPlugin({
        services,
        parseAppBuildRequestBody,
        toCapabilityError,
        renderAppBuildState,
        streamJobLogs,
      }))
      .use(createDeviceReadinessPlugin({
        services: {
          resolveDeviceAiReadinessEnvelope: services.resolveDeviceAiReadinessEnvelope ?? resolveDeviceAiReadinessEnvelope,
        },
        renderDeviceAiReadinessState,
      }))
      .use(createFlowRoutesPlugin({
        services,
        parseFlowRunRequestBody,
        renderFlowRunJobState,
        runFlow: (route, rawBody, runtimeServices) => runFlowHttpRoute(route, rawBody, runtimeServices, toCapabilityError),
        validateFlowYaml: (route, rawBody) => validateFlowYamlHttpRoute(route, rawBody, toCapabilityError),
        validateFlowAutomation: (route, rawBody) => validateFlowAutomationHttpRoute(route, rawBody, toCapabilityError),
        flowCapabilityMatrix: (route, targetRaw) => renderFlowCapabilityMatrixHttpRoute(route, targetRaw, toCapabilityError),
        streamJobLogs,
      }))
      .use(createAiWorkflowPlugin({
        services,
        toCapabilityError,
        parseAiWorkflowModeSelection,
        parseAiWorkflowRequestBody,
        renderAiWorkflowFormFields,
        renderAiWorkflowRunState,
        renderAiWorkflowJobState,
        renderAiWorkflowCapabilitiesState,
        streamJobLogs,
      }))
      .use(createAiProviderManagementPlugin({
        toCapabilityError,
        parseProviderValidationBody,
        validateProviders,
        renderProviderValidationState,
        isSupportedHttpUrl,
        renderModelSelectionOptions,
        buildModelSelectOptions,
        sanitizeApiErrorForDisplay,
      }))
      .use(createPreferencesPlugin({
        getPreference,
        setPreference,
        isSupportedTheme,
        isSupportedLocale,
        isValidModelIdentifier,
        setActiveLocale,
      }))
      .use(createUcpDiscoveryPlugin()))
    .onError(handleControlPlaneError)
    .onRequest(() => {
      syncActiveLocaleFromPreference();
    })
    .onBeforeHandle(({ requestId, request }) => {
      const url = new URL(request.url);
      if (!url.pathname.startsWith(PUBLIC_ASSET_ROUTE_PREFIX)) {
        logger.debug("Incoming request", { requestId, method: request.method, path: url.pathname });
      }
    })
    .onStop(() => {
      const closeResult = captureResult(
        () => sqlite.close(),
        (failure) => normalizeFailureMessage(failure, "Database shutdown failed."),
      );
      if (closeResult.ok) {
        logger.info("Database connection closed during graceful shutdown");
        return;
      }
      logger.warn("Error closing database during shutdown", {
        err: closeResult.error,
      });
    })
  // Dashboard + favicon + health routes provided by dashboardPlugin + healthPlugin above
  ;
}
