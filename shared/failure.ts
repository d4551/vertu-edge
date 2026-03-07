/**
 * Typed failure/result helpers shared across audited surfaces.
 * Centralizes exception capture into explicit result objects so callers can map
 * runtime failures to deterministic UI and lifecycle states.
 */

/** Values that can be normalized into a displayable failure message. */
export type FailureValue =
  | Error
  | string
  | number
  | boolean
  | null
  | undefined
  | {
    readonly message?: string | null;
  };

/** Success branch of a typed result. */
export interface SuccessResult<T> {
  ok: true;
  data: T;
}

/** Failure branch of a typed result. */
export interface FailureResult<E> {
  ok: false;
  error: E;
}

/** Typed result used instead of ad-hoc exception control flow. */
export type Result<T, E> = SuccessResult<T> | FailureResult<E>;

/** Normalize a failure value into a stable message for logs and UI envelopes. */
export function normalizeFailureMessage(failure: FailureValue, fallback: string): string {
  if (failure instanceof Error) {
    return failure.message;
  }
  if (
    typeof failure === "object"
    && failure !== null
    && typeof failure.message === "string"
    && failure.message.trim().length > 0
  ) {
    return failure.message;
  }
  if (typeof failure === "string" && failure.trim().length > 0) {
    return failure;
  }
  if (typeof failure === "number" || typeof failure === "boolean") {
    return String(failure);
  }
  return fallback;
}

/** Capture a synchronous operation as a typed result. */
export function captureResult<T, E>(
  operation: () => T,
  mapFailure: (failure: FailureValue) => E,
): Result<T, E> {
  try {
    return { ok: true, data: operation() };
  } catch (failure) {
    return { ok: false, error: mapFailure(failure as FailureValue) };
  }
}

/** Capture an asynchronous operation as a typed result. */
export async function captureResultAsync<T, E>(
  operation: () => Promise<T>,
  mapFailure: (failure: FailureValue) => E,
): Promise<Result<T, E>> {
  try {
    return { ok: true, data: await operation() };
  } catch (failure) {
    return { ok: false, error: mapFailure(failure as FailureValue) };
  }
}
