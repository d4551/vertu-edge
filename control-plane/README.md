# control-plane

Concierge AI Control Plane dashboard for Vertu Edge. Uses Elysia, HTMX, DaisyUI, and Tailwind.

## Runtime defaults

| Variable | Default | Description |
|---------|---------|-------------|
| `CONTROL_PLANE_PORT` | `CONTROL_PLANE_DEFAULT_PORT` (`3310` from `control-plane/src/config.ts`) | TCP port for the HTTP server |
| `PORT` | (same as `CONTROL_PLANE_DEFAULT_PORT`) | Alternative to `CONTROL_PLANE_PORT` |

Bun automatically loads `.env` if present.

## Implemented capability baseline

| Capability | Status | Contract | Runtime | Test |
|-----------|--------|----------|---------|------|
| `GET /` renders persisted theme and preference state | implemented | `control-plane/src/app.ts` | `control-plane/src/app.ts` | `flow run` and `ai chat` UI surfaces |
| `/api/flows/run` parse + execute FlowV1 with typed envelopes | implemented | `contracts/flow-contracts.ts` + `contracts/flow-parser.ts` | `control-plane/src/app.ts` + `control-plane/src/flow-engine.ts` | `control-plane/src/app.ts` |
| `/api/flows/trigger` executes same path as run | implemented | `contracts/flow-contracts.ts` + `contracts/flow-parser.ts` | `control-plane/src/app.ts` + `control-plane/src/flow-engine.ts` | `control-plane/src/app.ts` |
| `/api/models/pull` asynchronous Ramalama pull with typed envelope | implemented | `contracts/flow-contracts.ts` | `control-plane/src/app.ts` + `control-plane/src/model-manager.ts` + `control-plane/src/model-jobs.ts` | `control-plane/src/app.ts` |
| `/api/models/pull/:jobId` returns typed model pull state transitions | implemented | `contracts/flow-contracts.ts` | `control-plane/src/model-manager.ts` + `control-plane/src/model-jobs.ts` | `control-plane/src/app.ts` |
| `/api/models/sources` returns typed source registry envelope | implemented | `contracts/flow-contracts.ts` | `control-plane/src/app.ts` + `control-plane/src/config.ts` | `control-plane/test/http-model-build-routes.test.ts` |
| `/api/apps/build` asynchronous Android/iOS build orchestration | implemented | `contracts/flow-contracts.ts` | `control-plane/src/app.ts` + `control-plane/src/app-builds.ts` + `scripts/run_android_build.sh`/`scripts/run_ios_build.sh` | `control-plane/src/app.ts` |
| `/api/apps/build/:jobId` returns typed build state transitions | implemented | `contracts/flow-contracts.ts` | `control-plane/src/app-builds.ts` | `control-plane/src/app.ts` |
| iOS generation capability guard on non-mac hosts | unsupported-by-design (explicit runtime guard) | `contracts/flow-contracts.ts` | `control-plane/src/app-builds.ts` | `control-plane/src/app.ts` |
| `/api/prefs` persists theme/model with mismatch reporting | implemented | `contracts/flow-contracts.ts` | `control-plane/src/app.ts` + `control-plane/src/db.ts` | `control-plane/src/app.ts` |
| `/api/ai/chat` model resolution + unauthorized/error envelopes | implemented | `contracts/flow-contracts.ts` | `control-plane/src/app.ts` + `ai-providers.ts` | `control-plane/src/app.ts` |

See [`docs/CAPABILITY_AUDIT.md`](/Users/brandondonnelly/Downloads/vertu-edge/docs/CAPABILITY_AUDIT.md) for the full capability inventory and gap classification.

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

The Model Management card uses `ramalama` for model pulls and can target source adapters like Hugging Face and Ollama from `config/model-sources.json` (or `MODEL_SOURCE_REGISTRY_JSON`). If `ramalama` is not installed, the card shows a graceful fallback with install instructions.

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

Or run `./scripts/dev_bootstrap.sh` to optionally install it during setup.

For local Ollama model pulls, install Ollama from <https://ollama.com/download> and verify with:

```bash
ollama --version
```
