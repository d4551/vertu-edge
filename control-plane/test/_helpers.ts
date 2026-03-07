/** Shared test utilities for control-plane tests. */

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Temporarily replaces `globalThis.fetch` with a mock for the duration of the action.
 * Restores the original fetch on completion (even if the action rejects).
 */
export async function withMockedFetch<T>(mockFetch: FetchLike, action: () => Promise<T>): Promise<T> {
  const previousFetch = globalThis.fetch;
  (globalThis as { fetch: FetchLike }).fetch = mockFetch;
  return action().finally(() => {
    (globalThis as { fetch: FetchLike }).fetch = previousFetch;
  });
}
