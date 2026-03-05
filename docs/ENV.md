# Environment Variables

## Control-plane
- `CONTROL_PLANE_PORT` or `PORT`: HTTP server port. Default comes from `CONTROL_PLANE_DEFAULT_PORT` in `control-plane/src/config.ts`.
- `MODEL_SOURCE_REGISTRY_JSON`: Optional JSON override for `config/model-sources.json`.
- `MODEL_PULL_SOURCES`: Optional comma-separated/JSON list used by pull forms.
- `DEFAULT_MODEL_SOURCE`: Optional default source id used when pull payload omits source.
- `MODEL_PULL_PRESETS`: Optional pull preset list (comma-separated or JSON array).
- `MODEL_PULL_MODEL_REF_PLACEHOLDER`: Optional global model-ref placeholder override.
- `MODEL_PULL_TIMEOUT_MAX_MS`: Max allowed pull timeout.
- `AI_PROVIDER_REGISTRY_JSON`: Optional JSON override for `config/providers.json`.
- `AI_PROVIDER_REQUEST_TIMEOUT_MS`: Provider model-list/chat timeout.
- `AI_CHAT_MAX_TOKENS`: Max tokens for chat completion requests.
- `UCP_DISCOVERY_TIMEOUT_MS`: Timeout for UCP discovery calls.

## Android (Gradle / BuildConfig)
Set via `Android/src/vertu.local.properties` or shell env:
- `VERTU_CONTROL_PLANE_BASE_URL`
- `VERTU_CONTROL_PLANE_CONNECT_TIMEOUT_MS`
- `VERTU_CONTROL_PLANE_READ_TIMEOUT_MS`
- `VERTU_CONTROL_PLANE_POLL_INTERVAL_MS`
- `VERTU_CONTROL_PLANE_POLL_ATTEMPTS`
- `VERTU_CONTROL_PLANE_DEFAULT_PULL_TIMEOUT_MS`
- `VERTU_CONTROL_PLANE_DEFAULT_MODEL_SOURCE` (optional; if unset/blank, the source registry default is used)
- `VERTU_CONTROL_PLANE_MODEL_STATE_ID_PREFIX`

## iOS (runtime)
Set via Xcode scheme env vars or `UserDefaults`:
- `VERTU_CONTROL_PLANE_BASE_URL`
- `VERTU_CONTROL_PLANE_POLL_INTERVAL_MS`
- `VERTU_CONTROL_PLANE_POLL_ATTEMPTS`
- `VERTU_CONTROL_PLANE_DEFAULT_PULL_TIMEOUT_MS`
- `VERTU_CONTROL_PLANE_DEFAULT_MODEL_SOURCE` (optional override of control-plane registry default)
- `VERTU_CONTROL_PLANE_REQUEST_TIMEOUT_SECONDS`
- `VERTU_CONTROL_PLANE_MODEL_STATE_ID_PREFIX`
