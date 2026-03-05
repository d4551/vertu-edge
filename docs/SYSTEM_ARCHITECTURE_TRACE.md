# System Architecture Trace

Last updated: 2026-03-05

## Documentation Verification Inputs

- Context7 `/elysiajs/documentation`: lifecycle hooks, plugin composition (`group`, `guard`), schema validation, centralized `onError` handling.
- Context7 `/saadeghi/daisyui`: component + theme usage patterns, semantic classes with Tailwind utility composition, accessibility-first component usage.
- Context7 `/oven-sh/bun`: script orchestration (`bun run`) and process lifecycle handling (`Bun.spawn`) for deterministic tool execution.
- DaisyUI Blueprint MCP discovery: attempted via apps-tool discovery (`search_tool_bm25` queries for `daisyui blueprint`, `daisyUI-Snippets`, `Figma-to-daisyUI`); no DaisyUI Blueprint tool endpoints were exposed in this session.

## Runtime Topology

- Root orchestration: `scripts/verify_all.sh`, `scripts/run_control_plane.sh`, platform build scripts under `scripts/`.
- Web control plane: Elysia + SSR HTML + HTMX + DaisyUI assets in `control-plane/`.
- Shared contracts: `contracts/` used by control-plane, tooling, Android, and iOS.
- Tooling CLI: `tooling/vertu-flow-kit` for schema/flow validation.
- Native clients:
  - iOS package in `iOS/VertuEdge`
  - Android app + modules in `Android/src`
  - Kotlin multiplatform core in `vertu-core`

## Single-Owner Boundaries

| Concern | Primary owner | Notes |
| --- | --- | --- |
| HTTP request lifecycle and envelopes | `control-plane/src/app.ts` | Elysia route groups + typed envelope renderers |
| Runtime constants and config decode | `control-plane/src/config.ts` | Environment + JSON/JSONC parsing, source/provider registries |
| Provider transport + AI adapters | `control-plane/src/ai-providers.ts` | OpenAI-compatible chat/STT/TTS and provider model discovery |
| Async job persistence | `control-plane/src/db.ts` | Job tables, events, preferences, API keys |
| Flow execution and capability matrix | `control-plane/src/flow-engine.ts` | Target adapters and policy-driven command execution |
| Contract schemas/types | `contracts/flow-contracts.ts` + `contracts/ucp-contracts.ts` | Canonical cross-platform wire contract |
| Android cloud model manager state | `Android/src/app/.../ModelManagerViewModel.kt` | Provider/source state selection |
| iOS flow runner cloud selection | `iOS/VertuEdge/Sources/VertuEdgeUI/FlowRunnerView.swift` | Provider/source bootstrapping |

## Reliability and Performance Fixes Applied

- Removed module init fragility by repairing mixed type/value imports in config.
- Bound log-stream query validation to one shared route schema (`commandLogQuerySchema`) across flow/build log endpoints.
- Removed duplicated SSE loop logic by centralizing log streaming in a shared generator.
- Hardened chat TTS output parsing with deterministic format validation + MIME alias normalization.
- Removed silent dependency-install suppression in vendored asset pipeline.
- Removed masked resolver failures in Java/Android setup helpers and made Android SDK license acceptance fail-fast.
- Removed residual build-script failure masking in iOS/Xcode discovery and control-plane smoke-process teardown paths.
- Removed route-layer model-search type casts by parsing to exported `HfSort` contract values.
- Removed remaining flow-kit `unknown`-typed manifest parsing/index signatures and tightened the repository code-practice gate accordingly.
- Removed `unknown`-typed API-key row decoding in control-plane credential storage by switching to typed Bun SQLite query rows.
- Removed flow-run result `try/catch` JSON parsing and `unknown` payload guards by using shared config JSON parsing (`safeParseJson`) with typed JSON record guards.
- Removed `unknown`-typed jobs/events/preference DB row decoding in control-plane persistence by switching to typed Bun SQLite query rows with deterministic normalization.
- Removed residual `unknown` object-guard typing in provider adapters and tightened code-practice unknown-type allowlist coverage.
- Removed `unknown`-typed app-build failure normalization and tightened code-practice unknown-type allowlist coverage for `app-builds`.
- Removed `unknown`-typed UCP discovery payload guards by reusing shared typed JSON parsing (`safeParseJson`) and config JSON types, then tightened unknown-type allowlist coverage for `ucp-discovery`.
- Localized chat transcript/TTS ARIA labels in control-plane rendering to close i18n + WCAG language drift.
- Added canonical `/api/health` route and corrected `NOT_FOUND` handling to deterministic 404 envelopes (instead of generic 500 failures).
- Hardened online dependency freshness checks with npm lookup retries and per-package cache to reduce transient registry/network variance.
- Updated vendored DaisyUI assets and pin annotations to latest stable (`5.5.19`) and validated with online freshness mode.
- Fixed iOS and Android compile blockers uncovered by full-stack verification.

## Verification Matrix

- `bun run typecheck`: pass
- `bun run lint`: pass
- `bun run test`: pass
- `VERSION_FRESHNESS_MODE=online bun run scripts/check-version-freshness.ts`: pass
- Control-plane boot smoke (`scripts/dev_bootstrap.sh` smoke step and route checks): pass
- Full stack script (`./scripts/verify_all.sh`): pass
