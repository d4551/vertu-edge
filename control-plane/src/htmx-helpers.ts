/**
 * HTMX UI helpers for consistent loading indicators and swap behavior.
 */

/** Default swap modifiers for HTMX requests (animation and focus). */
const HTMX_SWAP_MODIFIERS = "swap:300ms settle:200ms focus-scroll:true";

/** Full hx-swap value for innerHTML replacement. */
export const HTMX_SWAP_INNER = `innerHTML ${HTMX_SWAP_MODIFIERS}`;

/** Full hx-swap value for beforeend (append) replacement. */
export const HTMX_SWAP_BEFOREEND = `beforeend ${HTMX_SWAP_MODIFIERS}`;

/** Render an HTMX indicator spinner span. */
export function htmxSpinner(id: string, margin: "ml-1" | "ml-2" = "ml-2"): string {
  return `<span id="${id}" class="htmx-indicator loading loading-spinner loading-sm ${margin}"></span>`;
}
