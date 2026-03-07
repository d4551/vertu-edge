/** Layout runtime constants and overridable defaults for browser assets.
 * Uses /public/ prefix to match @elysiajs/static default; local files only (no CDN).
 * Run scripts/vendor_control_plane_assets.sh to fetch from npm registry and vendor locally.
 */
export const PUBLIC_ASSET_ROUTE_PREFIX = "/public" as const;
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

export const HTMX_JOB_POLL_EXTENSION_SCRIPT_PATH_FALLBACK = "/public/htmx-ext-job-poll.js" as const;
export const HTMX_JOB_POLL_EXTENSION_SCRIPT_PATH =
  process.env.HTMX_JOB_POLL_EXTENSION_SCRIPT_PATH ?? HTMX_JOB_POLL_EXTENSION_SCRIPT_PATH_FALLBACK;

export const CONTROL_PLANE_SCRIPT_PATH = "/public/control-plane.js" as const;

/** Canonical favicon route for the SSR shell. */
export const FAVICON_ROUTE = "/favicon.ico" as const;

/** Canonical route for model-pull capability requests. */
export const MODEL_PULL_ROUTE = "/api/models/pull" as const;

/** Canonical route for local model inventory requests. */
export const MODEL_INVENTORY_ROUTE = "/api/models/inventory" as const;

/** Canonical route for model source registry requests. */
export const MODEL_SOURCE_ROUTE = "/api/models/sources" as const;

/** Canonical route for model search requests. */
export const MODEL_SEARCH_ROUTE = "/api/models/search" as const;

/** Canonical route for app-build capability requests. */
export const APP_BUILD_ROUTE = "/api/apps/build" as const;

/** Canonical repo-relative flow-kit working directory used by background build jobs. */
export const FLOW_KIT_DIRECTORY_RELATIVE = "tooling/vertu-flow-kit" as const;

/** Canonical repo-relative flow-kit CLI entrypoint used by background build jobs. */
export const FLOW_KIT_CLI_RELATIVE = "tooling/vertu-flow-kit/src/cli.ts" as const;

/** Canonical route for device-AI readiness rendering requests. */
export const DEVICE_AI_READINESS_ROUTE = "/api/device-ai/readiness" as const;

/** Canonical route for control-plane health checks. */
export const API_HEALTH_ROUTE = "/api/health" as const;

/** Canonical route for flow automation readiness checks. */
export const FLOW_AUTOMATION_VALIDATE_ROUTE = "/api/flows/validate/automation" as const;

/** Canonical route for synchronous flow execution requests. */
export const FLOW_RUN_ROUTE = "/api/flows/run" as const;

/** Canonical route for asynchronous flow trigger requests. */
export const FLOW_TRIGGER_ROUTE = "/api/flows/trigger" as const;

/** Canonical route for flow validation requests. */
export const FLOW_VALIDATE_ROUTE = "/api/flows/validate" as const;

/** Canonical route for flow target capability checks. */
export const FLOW_CAPABILITIES_ROUTE = "/api/flows/capabilities" as const;

/** Canonical route for creative workflow run requests. */
export const AI_WORKFLOW_RUN_ROUTE = "/api/ai/workflows/run" as const;

/** Canonical route for creative workflow job polling requests. */
export const AI_WORKFLOW_JOBS_ROUTE = "/api/ai/workflows/jobs" as const;

/** Canonical route for creative workflow capability checks. */
export const AI_WORKFLOW_CAPABILITIES_ROUTE = "/api/ai/workflows/capabilities" as const;

/** Canonical route for provider validation requests. */
export const PROVIDER_VALIDATE_ROUTE = "/api/ai/providers/validate" as const;

/* ─── Canonical provider identifiers ─── */
export const PROVIDER_ID_OLLAMA = "ollama" as const;
export const PROVIDER_ID_ANTHROPIC = "anthropic" as const;
export const PROVIDER_ID_OPENAI = "openai" as const;
export const PROVIDER_ID_GOOGLE = "google" as const;
export const PROVIDER_ID_HUGGINGFACE = "huggingface" as const;
export const PROVIDER_ID_OPENROUTER = "openrouter" as const;
export const PROVIDER_ID_MISTRAL = "mistral" as const;
export const PROVIDER_ID_GROQ = "groq" as const;
export const PROVIDER_ID_DEEPSEEK = "deepseek" as const;

export type ProviderId =
  | typeof PROVIDER_ID_OLLAMA
  | typeof PROVIDER_ID_ANTHROPIC
  | typeof PROVIDER_ID_OPENAI
  | typeof PROVIDER_ID_GOOGLE
  | typeof PROVIDER_ID_HUGGINGFACE
  | typeof PROVIDER_ID_OPENROUTER
  | typeof PROVIDER_ID_MISTRAL
  | typeof PROVIDER_ID_GROQ
  | typeof PROVIDER_ID_DEEPSEEK;

/* ─── External tool binary names ─── */
export const ANDROID_ADB_COMMAND = "adb" as const;
export const IOS_XCRUN_COMMAND = "xcrun" as const;

/* ─── HTTP content types ─── */
export const HTML_CONTENT_TYPE = "text/html; charset=utf-8" as const;

/* ─── HuggingFace canonical host ─── */
export const HUGGINGFACE_CANONICAL_HOST = "huggingface.co" as const;

/* ─── HTTP status codes ─── */
export const HTTP_OK = 200 as const;
export const HTTP_BAD_REQUEST = 400 as const;
export const HTTP_UNAUTHORIZED = 401 as const;
export const HTTP_FORBIDDEN = 403 as const;
export const HTTP_NOT_FOUND = 404 as const;
export const HTTP_SERVICE_UNAVAILABLE = 503 as const;

/* ─── Error name constants ─── */
export const ABORT_ERROR_NAME = "AbortError" as const;
export const TIMEOUT_ERROR_NAME = "TimeoutError" as const;
