#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/java21.sh"
source "$ROOT_DIR/scripts/lib/android_sdk.sh"
DEFAULT_CONTROL_PLANE_PORT="$(bun -e 'import { CONTROL_PLANE_DEFAULT_PORT } from "./control-plane/src/config"; console.log(CONTROL_PLANE_DEFAULT_PORT);')"
CONTROL_PLANE_PORT="${CONTROL_PLANE_PORT:-${DEFAULT_CONTROL_PLANE_PORT}}"

log() {
  printf '[dev-bootstrap] %s\n' "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Missing required command: $1"
    exit 1
  fi
}

log "Checking required tools"
require_cmd bun
require_cmd swift
if ! install_java21_if_missing; then
  log "Unable to resolve Java 21 runtime automatically."
  log "Install Java 21 and retry (for example: brew install openjdk@21)."
  exit 1
fi
log "Using Java 21 from JAVA_HOME=$JAVA_HOME"

log "Installing control-plane dependencies"
cd "$ROOT_DIR/control-plane"
bun install
bun run typecheck
bun run lint

log "Running repository policy audits"
cd "$ROOT_DIR"
bun run scripts/check-code-practices.ts
bun run scripts/check-capability-gaps.ts
bun run scripts/check-version-freshness.ts

log "Smoke testing control-plane HTTP server"
cd "$ROOT_DIR/control-plane"
CONTROL_PLANE_PORT="$CONTROL_PLANE_PORT" bun run src/index.ts >/tmp/vertu-control-plane-smoke.log 2>&1 &
cp_pid=$!
sleep 2
curl -fsS "http://127.0.0.1:${CONTROL_PLANE_PORT}/" >/dev/null
if ! kill "$cp_pid" >/dev/null 2>&1; then
  log "Control-plane smoke process exited before shutdown signal."
fi
if ! wait "$cp_pid" >/dev/null 2>&1; then
  # Expected when process is terminated by signal after successful smoke check.
  :
fi

if ! command -v ramalama >/dev/null 2>&1; then
  log "Installing ramalama CLI (optional, for model pull from dashboard)"
  if command -v pip >/dev/null 2>&1 || command -v pip3 >/dev/null 2>&1; then
    (pip install ramalama 2>/dev/null || pip3 install ramalama 2>/dev/null) && log "ramalama installed" || log "ramalama install skipped (pip failed)"
  elif command -v brew >/dev/null 2>&1; then
    brew install ramalama 2>/dev/null && log "ramalama installed" || log "ramalama install skipped (brew failed)"
  else
    log "ramalama not installed. For model pull: pip install ramalama or curl -fsSL https://ramalama.ai/install.sh | bash"
  fi
else
  log "ramalama already installed"
fi

if ! command -v ollama >/dev/null 2>&1; then
  log "Installing Ollama CLI (optional, for local model pull/list parity)"
  if command -v brew >/dev/null 2>&1; then
    brew install ollama 2>/dev/null && log "ollama installed" || log "ollama install skipped (brew failed)"
  else
    log "ollama not installed. Install manually from https://ollama.com/download"
  fi
else
  log "ollama already installed"
fi

log "Installing flow-kit dependencies"
cd "$ROOT_DIR/tooling/vertu-flow-kit"
bun install
bun run typecheck
bun run lint
bun test

log "Running iOS swift package tests"
cd "$ROOT_DIR/iOS/VertuEdge"
swift test

log "Running Android/KMP verification"
if ! install_android_sdk_if_missing; then
  log "Unable to resolve/install Android SDK packages automatically."
  log "Install Android SDK cmdline tools and required SDK platform packages, then retry."
  exit 1
fi
if ! ensure_android_local_properties "$ROOT_DIR"; then
  log "Unable to write Android/src/local.properties with sdk.dir."
  exit 1
fi
if [[ ! -f "$ROOT_DIR/Android/src/vertu.local.properties" ]]; then
  if [[ -f "$ROOT_DIR/Android/src/vertu.local.properties.example" ]]; then
    cp "$ROOT_DIR/Android/src/vertu.local.properties.example" "$ROOT_DIR/Android/src/vertu.local.properties"
    log "Created Android/src/vertu.local.properties from template."
  else
    log "ERROR: Android/src/vertu.local.properties and template are missing."
    exit 1
  fi
fi
cd "$ROOT_DIR/Android/src"
./gradlew :vertu-core:jvmTest :vertu-android-rpa:testDebugUnitTest :app:compileDebugKotlin

log "Bootstrap complete"
