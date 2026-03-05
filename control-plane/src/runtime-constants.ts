/** Layout runtime constants and overridable defaults for browser assets.
 * Uses /public/ prefix to match @elysiajs/static default; local files only (no CDN).
 * Run scripts/vendor_control_plane_assets.sh to fetch from npm registry and vendor locally.
 */
export const HTMX_SCRIPT_PATH_FALLBACK = "/public/htmx.min.js" as const;
export const HTMX_SSE_EXTENSION_SCRIPT_PATH_FALLBACK = "/public/htmx-ext-sse.min.js" as const;
export const TAILWIND_BROWSER_SCRIPT_PATH_FALLBACK = "/public/tailwindcss-browser.js" as const;
export const DAISYUI_CSS_PATH_FALLBACK = "/public/daisyui.css" as const;
export const BRAND_OVERRIDES_CSS_PATH_FALLBACK = "/public/brand-overrides.css" as const;

export const HTMX_SCRIPT_PATH = process.env.HTMX_SCRIPT_PATH ?? HTMX_SCRIPT_PATH_FALLBACK;
export const HTMX_SSE_EXTENSION_SCRIPT_PATH =
  process.env.HTMX_SSE_EXTENSION_SCRIPT_PATH ?? HTMX_SSE_EXTENSION_SCRIPT_PATH_FALLBACK;
export const TAILWIND_BROWSER_SCRIPT_PATH =
  process.env.TAILWIND_BROWSER_SCRIPT_PATH ?? TAILWIND_BROWSER_SCRIPT_PATH_FALLBACK;
export const DAISYUI_CSS_PATH = process.env.DAISYUI_CSS_PATH ?? DAISYUI_CSS_PATH_FALLBACK;
export const BRAND_OVERRIDES_CSS_PATH =
  process.env.BRAND_OVERRIDES_CSS_PATH ?? BRAND_OVERRIDES_CSS_PATH_FALLBACK;

export const CONTROL_PLANE_SCRIPT_PATH = "/public/control-plane.js" as const;

/** Canonical route for model-pull capability requests. */
export const MODEL_PULL_ROUTE = "/api/models/pull" as const;

/** Canonical route for model source registry requests. */
export const MODEL_SOURCE_ROUTE = "/api/models/sources" as const;

/** Canonical route for model search requests. */
export const MODEL_SEARCH_ROUTE = "/api/models/search" as const;

/** Canonical route for app-build capability requests. */
export const APP_BUILD_ROUTE = "/api/apps/build" as const;

/** Canonical route for control-plane health checks. */
export const API_HEALTH_ROUTE = "/api/health" as const;

/** Canonical route for flow automation readiness checks. */
export const FLOW_AUTOMATION_VALIDATE_ROUTE = "/api/flows/validate/automation" as const;

/** Script name used to run Android builds. */
export const RUN_ANDROID_BUILD_SCRIPT = "run_android_build.sh" as const;

/** Script name used to run iOS builds. */
export const RUN_IOS_BUILD_SCRIPT = "run_ios_build.sh" as const;
