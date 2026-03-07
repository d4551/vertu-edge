import type {
  FlowCapabilityError,
  FlowCapabilitySurface,
  FlowRunResult,
} from "../../contracts/flow-contracts";
import { createFlowCapabilityError, isFlowCapabilityError } from "../../contracts/flow-contracts";
import { t } from "./i18n";

/** Accepted failure inputs normalized into the shared capability-error envelope. */
export type CapabilityFailure =
  | FlowCapabilityError
  | Error
  | string
  | number
  | boolean
  | null
  | undefined
  | {
    readonly commandIndex?: number | null;
    readonly command?: string | null;
    readonly reason?: string | null;
    readonly retryable?: boolean | null;
    readonly message?: string | null;
  };

/** Convert flow execution result failures into deterministic mismatch strings. */
export function toFlowMismatches(result: FlowRunResult): string[] {
  return result.results
    .flatMap((step) => {
      if (step.state === "success") return [];
      const base = `${step.commandType} failed at command ${step.commandIndex + 1}.`;
      if (!step.error) {
        return [base];
      }
      return [`${base} ${step.error.reason}${step.error.retryable ? " (retryable)" : ""}`];
    });
}

/** Normalize arbitrary thrown values into a user-displayable message. */
export function normalizeFailureMessage(failure: CapabilityFailure): string {
  if (failure instanceof Error) {
    return failure.message;
  }
  if (
    typeof failure === "object"
    && failure !== null
    && "message" in failure
    && typeof failure.message === "string"
  ) {
    return failure.message;
  }
  if (typeof failure === "string") {
    return failure;
  }
  if (typeof failure === "number" || typeof failure === "boolean") {
    return String(failure);
  }
  return t("api.request_failed");
}

/** Convert arbitrary failures into the canonical `FlowCapabilityError` envelope. */
export function toCapabilityError(
  failure: CapabilityFailure,
  command: string,
  surface?: FlowCapabilitySurface,
): FlowCapabilityError {
  if (isFlowCapabilityError(failure)) {
    return failure;
  }
  return createFlowCapabilityError({
    commandIndex: -1,
    command,
    reason: normalizeFailureMessage(failure),
    retryable: false,
    surface,
  });
}
