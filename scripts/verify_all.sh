#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/java21.sh"
source "$ROOT_DIR/scripts/lib/android_sdk.sh"

if ! ensure_java21_available; then
  echo "Java 21 is required. Install via ./scripts/dev_bootstrap.sh or 'brew install openjdk@21'." >&2
  exit 1
fi

if ! install_android_sdk_if_missing; then
  echo "Android SDK is required. Install via ./scripts/dev_bootstrap.sh and ensure sdkmanager packages are available." >&2
  exit 1
fi
if ! ensure_android_local_properties "$ROOT_DIR"; then
  echo "Unable to write Android/src/local.properties with sdk.dir" >&2
  exit 1
fi

cd "$ROOT_DIR/control-plane"
bun run typecheck
bun run lint
bun test

cd "$ROOT_DIR/tooling/vertu-flow-kit"
bun run typecheck
bun run lint
bun test
bun run doctor

cd "$ROOT_DIR"
bun run scripts/check-code-practices.ts
bun run scripts/check-capability-gaps.ts
bun run scripts/check-version-freshness.ts

cd "$ROOT_DIR/iOS/VertuEdge"
swift test

cd "$ROOT_DIR/Android/src"
./gradlew :vertu-core:jvmTest :vertu-android-rpa:testDebugUnitTest :app:compileDebugKotlin
