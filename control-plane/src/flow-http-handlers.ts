import { parseMaestroYaml } from "./yaml-parser";
import { parseFlowTarget } from "./flow-target-parser";
import { DEFAULT_FLOW_TARGET, MAX_YAML_BYTES } from "./config";
import { tInterp } from "./i18n";
import { analyzeFlowAutomationCompatibility } from "./flow-automation";
import { toFlowMismatches, type CapabilityFailure } from "./capability-errors";
import { parseFlowRunRequestBody } from "./request-parsers";
import {
  renderFlowAutomationValidateState,
  renderFlowCapabilityMatrixState,
  renderFlowRunState,
  renderFlowValidateState,
} from "./flow-renderers";
import {
  FLOW_AUTOMATION_VALIDATE_ROUTE,
  FLOW_CAPABILITIES_ROUTE,
  FLOW_RUN_ROUTE,
  FLOW_TRIGGER_ROUTE,
  FLOW_VALIDATE_ROUTE,
} from "./runtime-constants";
import { getFlowCapabilityMatrix } from "./flow-engine";
import type { ControlPlaneServices } from "./app";
import type { RequestBodyRecord, RequestFieldValue } from "./http-helpers";
import {
  createFlowCapabilityError,
  type FlowCapabilitySurface,
  type FlowAutomationValidateEnvelope,
  type FlowCapabilityMatrixEnvelope,
  type FlowRunEnvelope,
  type FlowRunResult,
  type FlowValidateEnvelope,
  type FlowValidationResult,
} from "../../contracts/flow-contracts";

/** Flow execution routes accepted by the shared HTTP handler. */
export type FlowRunRoute = typeof FLOW_RUN_ROUTE | typeof FLOW_TRIGGER_ROUTE;

/** Minimal runtime dependencies required by the flow HTTP handlers. */
export type FlowHttpHandlerServices = Pick<ControlPlaneServices, "runFlow">;

/** Convert arbitrary failures into typed capability errors for flow surfaces. */
export type FlowFailureNormalizer = (
  failure: CapabilityFailure,
  command: string,
  surface?: FlowCapabilitySurface,
) => ReturnType<typeof createFlowCapabilityError>;

function isFlowRunRoute(route: string): route is FlowRunRoute {
  return route === FLOW_RUN_ROUTE || route === FLOW_TRIGGER_ROUTE;
}

/** Execute and render `/api/flows/run` and `/api/flows/trigger` with deterministic envelopes. */
export async function runFlowHttpRoute(
  route: FlowRunRoute,
  rawBody: RequestBodyRecord | null | undefined,
  services: FlowHttpHandlerServices,
  normalizeFailure: FlowFailureNormalizer,
): Promise<string> {
  if (!isFlowRunRoute(route)) {
    throw createFlowCapabilityError({
      commandIndex: -1,
      command: "route",
      reason: "Unsupported flow run endpoint.",
      retryable: false,
      surface: "flow",
    });
  }

  const body = parseFlowRunRequestBody(rawBody);
  if (body.yaml && Buffer.byteLength(body.yaml, "utf8") > MAX_YAML_BYTES) {
    const flowError = createFlowCapabilityError({
      commandIndex: -1,
      command: "yaml",
      reason: `Flow YAML payload exceeds the maximum allowed size of ${MAX_YAML_BYTES} bytes.`,
      retryable: false,
      surface: "flow",
    });
    const envelope: FlowRunEnvelope = {
      route,
      state: "error-non-retryable",
      error: flowError,
      mismatches: [flowError.reason],
    };
    return renderFlowRunState(route, envelope);
  }

  if (!body.yaml || body.yaml.trim().length === 0) {
    const envelope: FlowRunEnvelope = {
      route,
      state: "empty",
      mismatches: [tInterp("api.flows_no_yaml_detail", {})],
    };
    return renderFlowRunState(route, envelope);
  }

  const runFlowRequest = services.runFlow;
  if (!runFlowRequest) {
    const flowError = createFlowCapabilityError({
      commandIndex: -1,
      command: "runtime",
      reason: "Flow execution service is unavailable.",
      retryable: false,
      surface: "flow",
    });
    const envelope: FlowRunEnvelope = {
      route,
      state: "error-non-retryable",
      error: flowError,
      mismatches: [flowError.reason],
    };
    return renderFlowRunState(route, envelope);
  }

  return Promise.resolve(runFlowRequest(body)).then((result: FlowRunResult | undefined) => {
    if (!result) {
      const flowError = createFlowCapabilityError({
        commandIndex: -1,
        command: "flow",
        reason: "Flow execution service returned no result.",
        retryable: false,
        surface: "flow",
      });
      const envelope: FlowRunEnvelope = {
        route,
        state: "error-non-retryable",
        error: flowError,
        mismatches: [flowError.reason],
      };
      return renderFlowRunState(route, envelope);
    }

    const envelope: FlowRunEnvelope = {
      route,
      state: result.state,
      data: result,
      mismatches: toFlowMismatches(result),
    };
    return renderFlowRunState(route, envelope);
  }, (failure) => {
    const flowError = normalizeFailure(failure, "flow", "flow");
    const envelope: FlowRunEnvelope = {
      route,
      state: flowError.retryable ? "error-retryable" : "error-non-retryable",
      error: flowError,
      mismatches: [flowError.reason],
    };
    return renderFlowRunState(route, envelope);
  });
}

/** Parse-only flow validation endpoint without runtime command execution. */
export async function validateFlowYamlHttpRoute(
  route: typeof FLOW_VALIDATE_ROUTE,
  rawBody: RequestBodyRecord | null | undefined,
  normalizeFailure: FlowFailureNormalizer,
): Promise<string> {
  const body = parseFlowRunRequestBody(rawBody);
  if (body.yaml && Buffer.byteLength(body.yaml, "utf8") > MAX_YAML_BYTES) {
    const flowError = createFlowCapabilityError({
      commandIndex: -1,
      command: "yaml",
      reason: `Flow YAML payload exceeds the maximum allowed size of ${MAX_YAML_BYTES} bytes.`,
      retryable: false,
      surface: "flow",
    });
    const envelope: FlowValidateEnvelope = {
      route,
      state: "error-non-retryable",
      error: flowError,
      mismatches: [flowError.reason],
    };
    return renderFlowValidateState(route, envelope);
  }

  if (!body.yaml || body.yaml.trim().length === 0) {
    const envelope: FlowValidateEnvelope = {
      route,
      state: "empty",
      mismatches: [tInterp("api.flows_no_yaml_detail", {})],
    };
    return renderFlowValidateState(route, envelope);
  }

  return Promise.resolve()
    .then(() => parseMaestroYaml(body.yaml))
    .then((flow) => {
      const data: FlowValidationResult = {
        appId: flow.appId,
        commandCount: flow.steps.length,
        commandTypes: flow.steps.map((step) => step.type),
      };
      const envelope: FlowValidateEnvelope = {
        route,
        state: "success",
        data,
        mismatches: [],
      };
      return renderFlowValidateState(route, envelope);
    }, (failure) => {
      const flowError = normalizeFailure(failure, "flow_validate", "flow");
      const envelope: FlowValidateEnvelope = {
        route,
        state: flowError.retryable ? "error-retryable" : "error-non-retryable",
        error: flowError,
        mismatches: [flowError.reason],
      };
      return renderFlowValidateState(route, envelope);
    });
}

/** Parse flow YAML and render per-step automation compatibility details. */
export async function validateFlowAutomationHttpRoute(
  route: typeof FLOW_AUTOMATION_VALIDATE_ROUTE,
  rawBody: RequestBodyRecord | null | undefined,
  normalizeFailure: FlowFailureNormalizer,
): Promise<string> {
  const body = parseFlowRunRequestBody(rawBody);
  if (body.yaml && Buffer.byteLength(body.yaml, "utf8") > MAX_YAML_BYTES) {
    const flowError = createFlowCapabilityError({
      commandIndex: -1,
      command: "yaml",
      reason: `Flow YAML payload exceeds the maximum allowed size of ${MAX_YAML_BYTES} bytes.`,
      retryable: false,
      surface: "flow_automation",
    });
    const envelope: FlowAutomationValidateEnvelope = {
      route,
      state: "error-non-retryable",
      error: flowError,
      mismatches: [flowError.reason],
    };
    return renderFlowAutomationValidateState(route, envelope);
  }

  if (!body.yaml || body.yaml.trim().length === 0) {
    const envelope: FlowAutomationValidateEnvelope = {
      route,
      state: "empty",
      mismatches: [tInterp("api.flows_no_yaml_detail", {})],
    };
    return renderFlowAutomationValidateState(route, envelope);
  }

  return Promise.resolve()
    .then(() => analyzeFlowAutomationCompatibility(body.yaml, body.target ?? DEFAULT_FLOW_TARGET))
    .then(({ data, mismatches, targetReadinessFailure }) => {
      const isComplete = data.supportedCommandCount === data.commandCount;
      const state = targetReadinessFailure
        ? (targetReadinessFailure.retryable ? "error-retryable" : "error-non-retryable")
        : isComplete
          ? "success"
          : "error-non-retryable";
      const envelope: FlowAutomationValidateEnvelope = {
        route,
        state,
        error: targetReadinessFailure ?? undefined,
        data,
        mismatches,
      };
      return renderFlowAutomationValidateState(route, envelope);
    }, (failure) => {
      const flowError = normalizeFailure(failure, "flow_automation", "flow_automation");
      const envelope: FlowAutomationValidateEnvelope = {
        route,
        state: flowError.retryable ? "error-retryable" : "error-non-retryable",
        error: flowError,
        mismatches: [flowError.reason],
      };
      return renderFlowAutomationValidateState(route, envelope);
    });
}

/** Resolve and render the target capability matrix for flow admission checks. */
export async function renderFlowCapabilityMatrixHttpRoute(
  route: typeof FLOW_CAPABILITIES_ROUTE,
  targetRaw: RequestFieldValue,
  normalizeFailure: FlowFailureNormalizer,
): Promise<string> {
  const target = parseFlowTarget(targetRaw);
  return Promise.resolve()
    .then(() => getFlowCapabilityMatrix(target))
    .then((data) => {
      const envelope: FlowCapabilityMatrixEnvelope = {
        route,
        state: data.ready ? "success" : "error-non-retryable",
        data,
        mismatches: data.ready ? [] : data.requirements.filter((item) => item.required && !item.installed).map((item) => item.description),
      };
      return renderFlowCapabilityMatrixState(route, envelope);
    }, (failure) => {
      const flowError = normalizeFailure(failure, "flow_capabilities", "flow_capabilities");
      const envelope: FlowCapabilityMatrixEnvelope = {
        route,
        state: flowError.retryable ? "error-retryable" : "error-non-retryable",
        error: flowError,
        mismatches: [flowError.reason],
      };
      return renderFlowCapabilityMatrixState(route, envelope);
    });
}
