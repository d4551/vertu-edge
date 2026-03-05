# Capability Audit

Last updated: 2026-03-05

## API Route Capabilities

| name | source_of_claim | status | owner | gap_type | contract_ref | test_ref | runtime_ref |
| --- | --- | --- | --- | --- | --- | --- | --- |
| /api/flows/validate | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/flows/validate/automation | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/flows/capabilities | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/flows/run | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/flows/trigger | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/flows/runs | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/flows/runs/:runId | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/flows/runs/:runId/cancel | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/flows/runs/:runId/pause | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/flows/runs/:runId/resume | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/flows/runs/:runId/replay-step | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/flows/runs/:runId/logs | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/models/pull | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/models/pull/:jobId | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/models/sources | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/apps/build | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/apps/build/:jobId | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/ai/providers/validate | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/ai | FLOW_REFERENCE API routes | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| /api/health | Runtime service health contract | implemented | control-plane | none | control-plane/src/runtime-constants.ts | control-plane/test/http-model-build-routes.test.ts | control-plane/src/app.ts |
| Ramalama model pull capability | Model pull execution contract | implemented | control-plane | none | contracts/flow-contracts.ts | control-plane/test/model-build-jobs.test.ts | control-plane/src/model-manager.ts |
| iOS build unsupported on non-mac hosts | App build runtime guard | unsupported | control-plane | host-platform-guard | contracts/flow-contracts.ts | control-plane/test/model-build-jobs.test.ts | control-plane/src/app-builds.ts |

## Flow Command Platform Parity Matrix (2026-03-05)

| command | android | ios (control-plane capability) | native runtime expectation | gap | owner |
| --- | --- | --- | --- | --- | --- |
| `assertVisible` | supported | supported | supported | none | control-plane/src/flow-engine.ts |
| `assertNotVisible` | supported | supported | supported | none | control-plane/src/flow-engine.ts |
| `assertText` | supported | supported | supported | none | control-plane/src/flow-engine.ts |
| `scroll` | supported | supported | supported | none | control-plane/src/flow-engine.ts |
| `swipe` | supported | supported | supported | none | control-plane/src/flow-engine.ts |
| `selectOption` | supported | supported | supported | none | control-plane/src/flow-engine.ts |
| `hideKeyboard` | supported | supported | supported | none | control-plane/src/flow-engine.ts |
| `clipboardWrite` | supported | supported | supported | none | control-plane/src/flow-engine.ts |
| `clipboardRead` | unsupported | unsupported | unsupported | none | control-plane/src/flow-engine.ts |
| `windowFocus` | unsupported | unsupported | unsupported | none | control-plane/src/flow-engine.ts |

## Gap Register

| date | area | status | evidence | action |
| --- | --- | --- | --- | --- |
| 2026-03-05 | control-plane route-not-found semantics (`NOT_FOUND` lifecycle handling) | fixed | control-plane/src/app.ts + control-plane/test/http-model-build-routes.test.ts + control-plane/src/locales/*.json | Added explicit `NOT_FOUND` handling that returns deterministic 404 envelopes (instead of generic 500 fallback), with localized user-facing messaging. |
| 2026-03-05 | control-plane health endpoint contract (`/api/health`) | fixed | control-plane/src/runtime-constants.ts + control-plane/src/app.ts + control-plane/test/http-model-build-routes.test.ts | Added canonical health route for orchestration/runtime probing to remove implicit endpoint guesswork and ensure structured readiness checks. |
| 2026-03-05 | provider adapter guard typing drift (`control-plane/src/ai-providers.ts`) | fixed | control-plane/src/ai-providers.ts + scripts/check-code-practices.ts | Removed `unknown`-typed JSON object guard and tightened unknown-type allowlist to keep strict typing enforcement deterministic. |
| 2026-03-05 | app build failure parser typing drift (`control-plane/src/app-builds.ts`) | fixed | control-plane/src/app-builds.ts + scripts/check-code-practices.ts | Replaced `unknown`-typed build-failure parsing with explicit failure union narrowing and removed `app-builds` from unknown-type allowlist to enforce strict typing audits. |
| 2026-03-05 | UCP discovery parser typing drift (`control-plane/src/ucp-discovery.ts`) | fixed | control-plane/src/ucp-discovery.ts + control-plane/src/config.ts + scripts/check-code-practices.ts | Replaced module-local `unknown`/duplicated JSON typing with shared strict JSON parsing/types (`safeParseJson`, `JsonValue`, `JsonRecord`) and removed `ucp-discovery` from unknown-type allowlist. |
| 2026-03-05 | documentation/tooling verification coverage | fixed | docs/SYSTEM_ARCHITECTURE_TRACE.md + Context7 queries (`/elysiajs/documentation`, `/saadeghi/daisyui`, `/oven-sh/bun`) + apps discovery (`search_tool_bm25`) | Revalidated framework-native and component-library guidance before refactors; recorded explicit DaisyUI Blueprint MCP unavailability to remove tooling ambiguity for follow-up runs. |
| 2026-03-05 | control-plane config module initialization (`control-plane/src/config.ts`) | fixed | control-plane/src/config.ts | Repaired mixed `import type`/value imports for shared chat TTS constants to prevent module-evaluation `ReferenceError` cascades across app boot, DB init, provider registry, and test runtime. |
| 2026-03-05 | route contract drift on log stream query parsing (`/api/flows/runs/:runId/logs`, `/api/apps/build/:jobId/logs`) | fixed | control-plane/src/app.ts + control-plane/src/contracts/http.ts | Reused canonical `commandLogQuerySchema` in both routes so query validation is contract-first and shared, removing ad-hoc route-level schema drift. |
| 2026-03-05 | duplicated SSE log streaming routes (`/api/flows/runs/:runId/logs`, `/api/apps/build/:jobId/logs`) | fixed | control-plane/src/app.ts | Extracted shared `streamJobLogs` generator and reused it in both routes, removing duplicate cursor/normalization/tail logic to keep behavior deterministic and reduce drift risk. |
| 2026-03-05 | chat TTS format contract normalization (`/api/ai/chat`) | fixed | control-plane/src/app.ts | Added deterministic TTS output-format parsing with canonical format aliases and explicit non-retryable validation envelopes while preserving browser playback MIME compatibility. |
| 2026-03-05 | control-plane asset vendoring script reliability (`scripts/vendor_control_plane_assets.sh`) | fixed | scripts/vendor_control_plane_assets.sh | Removed silent `bun add ... || true` failure swallowing so package fetch failures now fail fast instead of producing partial or stale UI asset state. |
| 2026-03-05 | setup script resolver failure masking (`scripts/lib/java21.sh`, `scripts/lib/android_sdk.sh`) | fixed | scripts/lib/java21.sh + scripts/lib/android_sdk.sh | Removed resolver fallback `|| true` masking and converted SDK license acceptance into explicit checked failure path for deterministic bootstrap behavior. |
| 2026-03-05 | bootstrap/build script failure masking (`scripts/dev_bootstrap.sh`, `scripts/run_ios_build.sh`) | fixed | scripts/dev_bootstrap.sh + scripts/run_ios_build.sh | Removed `|| true` masking in smoke-process teardown and Xcode artifact discovery paths; replaced with explicit checked control flow so unexpected process/tool failures surface deterministically. |
| 2026-03-05 | chat accessibility/i18n drift (`renderChatRunState`) | fixed | control-plane/src/app.ts + control-plane/src/locales/*.json | Replaced hardcoded English ARIA labels for speech transcript and TTS response bubbles with localized i18n keys across EN/FR/ES locales. |
| 2026-03-05 | flow-kit schema typing drift (`tooling/vertu-flow-kit`) | fixed | tooling/vertu-flow-kit/src/schema.ts + tooling/vertu-flow-kit/src/commands.ts + scripts/check-code-practices.ts | Replaced `unknown`-typed JSON/index signatures with strict JSON union typing and removed now-unnecessary unknown-type allowlist exceptions to enforce stricter typing audits. |
| 2026-03-05 | control-plane API key parser typing drift (`control-plane/src/ai-keys.ts`) | fixed | control-plane/src/ai-keys.ts + scripts/check-code-practices.ts | Replaced `unknown`-typed DB row parsing with typed Bun SQLite row queries and removed `ai-keys` from unknown-type allowlist to enforce strict parsing contracts. |
| 2026-03-05 | flow-run persisted-result parser drift (`control-plane/src/flow-runs.ts`) | fixed | control-plane/src/flow-runs.ts + scripts/check-code-practices.ts | Replaced `try/catch` + `unknown` JSON parsing with shared `safeParseJson` contract parsing and typed JSON record guards; removed `flow-runs` from try/catch and unknown-type allowlists. |
| 2026-03-05 | control-plane persistence parser typing drift (`control-plane/src/db.ts`) | fixed | control-plane/src/db.ts + scripts/check-code-practices.ts | Replaced `unknown`-typed SQLite row parsers for jobs/events/preferences with typed query row contracts and removed `db.ts` from unknown-type allowlist. |
| 2026-03-05 | online dependency freshness check variance (`scripts/check-version-freshness.ts`) | fixed | scripts/check-version-freshness.ts | Added retry attempts and package-level lookup caching for `bun pm view` resolution so transient registry failures do not create avoidable audit flakiness. |
| 2026-03-05 | model-search route cast drift (`/api/models/search`) | fixed | control-plane/src/app.ts + control-plane/src/hf-search.ts | Replaced ad-hoc `as` casts with explicit `HfSort` parsing, keeping route inputs strictly typed and contract-aligned. |
| 2026-03-05 | stale DaisyUI pin annotation and vendored asset version drift | fixed | control-plane/src/layout.ts + control-plane/public/daisyui.css | Updated vendored DaisyUI assets to 5.5.19 and aligned layout pin annotation; online freshness check now passes without drift. |
| 2026-03-05 | flow automation validator (`/api/flows/validate/automation`) | fixed | control-plane/src/app.ts | Added selector/tap target discrimination and command-level field-level checks; `tapOn` now accepts selector-only object forms and `assertVisible`/`assertNotVisible`/`assertText`/`selectOption` now require selector targets in object form. |
| 2026-03-05 | automation parser (`contracts/flow-parser.ts`) | fixed | contracts/flow-parser.ts | Added dedicated selector/tap target normalization with clearer selector-only diagnostics. |
| 2026-03-05 | model pull persistence payload parsing (`control-plane/src/model-jobs.ts`) | fixed | control-plane/src/model-jobs.ts | Added timeout upper-bound parsing validation and trimmed model reference fields for persisted payload reconstruction. |
| 2026-03-05 | model pull endpoint validation (`/api/models/pull`) | fixed | control-plane/src/app.ts | Timeout/force request validation enforced before invoking `startModelPullJob`; malformed payloads now return deterministic non-retryable envelopes. |
