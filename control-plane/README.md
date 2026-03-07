# control-plane

[English](#english) · [中文](#中文)

Concierge AI Control Plane dashboard for Vertu Edge. Uses Elysia, HTMX, DaisyUI, and Tailwind.

## English

## Service composition

```mermaid
flowchart LR
  APP["app.ts bootstrap"]
  subgraph Plugins["Prefixed Elysia plugins"]
    HEALTH["health"]
    DASH["dashboard"]
    MODELS["model-management"]
    BUILDS["app-build"]
    READY["device-readiness"]
    FLOWS["flow-routes"]
    AIWF["ai-workflows"]
    AIP["ai-provider-management"]
    PREFS["preferences"]
    UCP["ucp-discovery"]
  end
  HELPERS["shared handlers, parsers, renderers"]

  APP --> Plugins
  FLOWS --> HELPERS
  MODELS --> HELPERS
  BUILDS --> HELPERS
  READY --> HELPERS
  AIWF --> HELPERS
  AIP --> HELPERS
```

## Runtime defaults

| Variable | Default | Description |
|---------|---------|-------------|
| `CONTROL_PLANE_PORT` | `CONTROL_PLANE_DEFAULT_PORT` (`3310` from `control-plane/src/config.ts`) | TCP port for the HTTP server |
| `PORT` | (same as `CONTROL_PLANE_DEFAULT_PORT`) | Alternative to `CONTROL_PLANE_PORT` |
| `VERTU_AUTH_TOKEN` | unset | Enables the control-plane auth boundary for every non-public route when configured |
| `VERTU_AUTH_COOKIE_NAME` | `vertu_edge_auth` | Cookie name accepted by the control-plane auth boundary for browser/HTMX requests |

Bun automatically loads `.env` if present.

Provider API keys are only persisted when `VERTU_ENCRYPTION_KEY` is configured with a 32-byte hex or base64 key.
`vertu-flow doctor` and `vertu-flow verify all` now fail if the database still contains plaintext provider credentials or encrypted credentials that cannot be decrypted with the active secure-storage key.

## Implemented capability baseline

| Capability | Status | Contract | Runtime | Test |
|-----------|--------|----------|---------|------|
| `GET /` renders persisted theme and preference state | implemented | `control-plane/src/app.ts` | `control-plane/src/app.ts` + `control-plane/src/layout.ts` | `flow run` and `ai chat` UI surfaces |
| `/api/flows/run` parse + execute FlowV1 with typed envelopes | implemented | `contracts/flow-contracts.ts` + `contracts/flow-parser.ts` | `control-plane/src/plugins/flow-routes.plugin.ts` + `control-plane/src/flow-engine.ts` | `control-plane/test/http-model-build-routes.test.ts` |
| `/api/flows/trigger` executes same path as run | implemented | `contracts/flow-contracts.ts` + `contracts/flow-parser.ts` | `control-plane/src/plugins/flow-routes.plugin.ts` + `control-plane/src/flow-engine.ts` | `control-plane/test/http-model-build-routes.test.ts` |
| `/api/models/pull` asynchronous Ramalama pull with typed envelope | implemented | `contracts/flow-contracts.ts` | `control-plane/src/plugins/model-management.plugin.ts` + `control-plane/src/model-manager.ts` + `control-plane/src/model-jobs.ts` | `control-plane/test/http-model-build-routes.test.ts` |
| `/api/models/pull/:jobId` returns typed model pull state transitions | implemented | `contracts/flow-contracts.ts` | `control-plane/src/plugins/model-management.plugin.ts` + `control-plane/src/model-manager.ts` + `control-plane/src/model-jobs.ts` | `control-plane/test/http-model-build-routes.test.ts` |
| `/api/models/sources` returns typed source registry envelope | implemented | `contracts/flow-contracts.ts` | `control-plane/src/plugins/model-management.plugin.ts` + `control-plane/src/config.ts` | `control-plane/test/http-model-build-routes.test.ts` |
| `/api/apps/build` asynchronous Android/iOS build orchestration | implemented | `contracts/flow-contracts.ts` | `control-plane/src/plugins/app-build.plugin.ts` + `control-plane/src/app-builds.ts` + `tooling/vertu-flow-kit/src/orchestration.ts` | `control-plane/test/http-model-build-routes.test.ts` |
| `/api/apps/build/:jobId` returns typed build state transitions | implemented | `contracts/flow-contracts.ts` | `control-plane/src/plugins/app-build.plugin.ts` + `control-plane/src/app-builds.ts` | `control-plane/test/http-model-build-routes.test.ts` |
| `/api/device-ai/readiness` host/runtime readiness fragment for the build dashboard | implemented | `contracts/flow-contracts.ts` | `control-plane/src/plugins/device-readiness.plugin.ts` + `control-plane/src/device-ai-readiness.ts` + `control-plane/src/device-readiness-renderers.ts` | `control-plane/test/http-model-build-routes.test.ts` |
| iOS generation capability guard on non-mac hosts | unsupported-by-design (explicit runtime guard) | `contracts/flow-contracts.ts` | `control-plane/src/plugins/app-build.plugin.ts` + `control-plane/src/app-builds.ts` | `control-plane/test/http-model-build-routes.test.ts` |
| `/api/prefs` persists theme/model with mismatch reporting | implemented | `contracts/flow-contracts.ts` | `control-plane/src/plugins/preferences.plugin.ts` + `control-plane/src/db/index.ts` | `control-plane/test/http-model-build-routes.test.ts` |
| `/api/ai/workflows/run` local-first workflow job dispatch | implemented | `contracts/flow-contracts.ts` | `control-plane/src/plugins/ai-workflows.plugin.ts` + `control-plane/src/ai-workflows/orchestrator.ts` | `control-plane/test/http-model-build-routes.test.ts` |
| `/api/ai/workflows/capabilities` workflow capability matrix | implemented | `contracts/flow-contracts.ts` | `control-plane/src/plugins/ai-workflows.plugin.ts` + `control-plane/src/ai-renderers.ts` | `control-plane/test/http-model-build-routes.test.ts` |
| `/api/ai/providers/validate` provider validation summary | implemented | `contracts/flow-contracts.ts` | `control-plane/src/plugins/ai-provider-management.plugin.ts` + `control-plane/src/provider-validation.ts` | `control-plane/test/http-model-build-routes.test.ts` |
| `/api/ai/chat` retired-route envelope | implemented | `contracts/flow-contracts.ts` | `control-plane/src/plugins/ai-provider-management.plugin.ts` | `control-plane/test/http-model-build-routes.test.ts` |

See [`docs/CAPABILITY_AUDIT.md`](/Users/brandondonnelly/Downloads/vertu-edge/docs/CAPABILITY_AUDIT.md) for the full capability inventory and gap classification.

## Single-owner modules

- `src/app.ts` owns bootstrap, locale sync, and plugin composition only.
- `src/middleware/auth.ts` owns the global control-plane auth boundary and unauthorized response shaping.
- `src/config/env.ts` owns environment readers and JSON/JSONC parsing helpers.
- `src/config.ts` owns exported runtime defaults, registry resolution, and typed config surfaces.
- `src/ai-keys.ts` + `src/services/encryption.ts` own encrypted provider credential persistence and secure-storage state.
- `src/flow-http-handlers.ts` owns shared flow route handlers.
- `src/provider-validation.ts` owns provider connectivity/configuration validation.
- `src/request-parsers.ts` owns capability-safe body/query coercion.
- `src/model-build-renderers.ts` owns model/app-build SSR fragments.
- `src/device-ai-readiness.ts` owns host/runtime readiness evaluation plus latest build artifact summary.
- `src/device-readiness-renderers.ts` owns the device-readiness SSR fragment.
- `src/flow-renderers.ts` owns flow SSR fragments.
- `src/ai-renderers.ts` owns workflow/provider SSR fragments.

## Install

```bash
bun install
```

## Run

```bash
bun run dev
```

Or directly: `bun run src/index.ts`

## Optional: ramalama + ollama

The Model Management card uses `ramalama` for model pulls and can target source adapters like Hugging Face and Ollama from the canonical checked-in config owners:
- `control-plane/config/model-sources.json`
- `control-plane/config/providers.json`
- `control-plane/config/model-pull-presets.json`

`MODEL_SOURCE_REGISTRY_JSON` and `AI_PROVIDER_REGISTRY_JSON` can override those files at startup, but the payloads must match the same canonical shapes. The control-plane no longer restores embedded fallback registries when these configs are malformed or missing. If `ramalama` is not installed, the card shows install instructions.

**Install ramalama** (pick one):

```bash
pip install ramalama
```

```bash
curl -fsSL https://ramalama.ai/install.sh | bash
```

```bash
brew install ramalama   # macOS
```

Repo bootstrap no longer installs optional CLIs for you. Install `ramalama` explicitly, then run `./scripts/dev_bootstrap.sh` or `bun run --cwd tooling/vertu-flow-kit src/cli.ts bootstrap`.

For local Ollama model pulls, install Ollama from <https://ollama.com/download> and verify with:

```bash
ollama --version
```

---

## 中文

Vertu Edge 的 Concierge AI 控制平面仪表盘，使用 Elysia、HTMX、DaisyUI 和 Tailwind。

### 运行

```bash
bun install
bun run dev
```

### 文档

完整能力清单与缺口分类见 [docs/CAPABILITY_AUDIT.md](../docs/CAPABILITY_AUDIT.md)。
