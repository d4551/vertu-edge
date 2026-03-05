#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/java21.sh"
source "$ROOT_DIR/scripts/lib/android_sdk.sh"
ANDROID_DIR="$ROOT_DIR/Android/src"
BUILD_TYPE="debug"
OUTPUT_DIR=""
VARIANT=""
RUN_TESTS=true
CLEAN=false

sha256_file() {
  local file_path="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file_path" | awk '{print $1}'
    return 0
  fi
  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file_path" | awk '{print $NF}'
    return 0
  fi
  return 1
}

emit_artifact_metadata() {
  local artifact_path="$1"
  local sha256_value="$2"
  local created_at="$3"
  if [[ -z "$artifact_path" || -z "$sha256_value" || -z "$created_at" ]]; then
    return 1
  fi

  local size_bytes
  size_bytes="$(wc -c < "$artifact_path" | tr -d '[:space:]')"
  if [[ -z "$size_bytes" ]]; then
    echo "Unable to compute artifact size for $artifact_path" >&2
    return 1
  fi

  local resolved_content_type="application/vnd.android.package-archive"
  echo "ARTIFACT_PATH=$artifact_path"
  echo "ARTIFACT_SHA256=$sha256_value"
  echo "ARTIFACT_SIZE_BYTES=$size_bytes"
  echo "ARTIFACT_CONTENT_TYPE=$resolved_content_type"
  echo "ARTIFACT_CREATED_AT=$created_at"
  if [[ -n "${VERTU_ARTIFACT_SIGNATURE:-}" ]]; then
    echo "ARTIFACT_SIGNATURE=${VERTU_ARTIFACT_SIGNATURE}"
  fi
  echo "ARTIFACT_METADATA_JSON={\"artifactPath\":\"$artifact_path\",\"sha256\":\"$sha256_value\",\"sizeBytes\":$size_bytes,\"createdAt\":\"$created_at\",\"contentType\":\"$resolved_content_type\",\"signature\":\"${VERTU_ARTIFACT_SIGNATURE:-}\",\"correlationId\":\"${VERTU_CORRELATION_ID:-unknown}\"}"
}

sanitize_locale() {
  local value="$1"
  if [ "$value" = "C.UTF-8" ]; then
    printf "%s" "C"
    return 0
  fi
  printf "%s" "$value"
}

LC_ALL="$(sanitize_locale "${LC_ALL:-}")"
LC_CTYPE="$(sanitize_locale "${LC_CTYPE:-}")"
LANG="$(sanitize_locale "${LANG:-}")"
if [ -z "$LC_ALL" ]; then
  LC_ALL="C"
fi
if [ -z "$LC_CTYPE" ]; then
  LC_CTYPE="C"
fi
if [ -z "$LANG" ]; then
  LANG="C"
fi
export LC_ALL LC_CTYPE LANG

capitalize_first() {
  local value="$1"
  if [ -z "$value" ]; then
    printf "%s" ""
    return 0
  fi
  local first_char
  local rest
  first_char="$(printf "%s" "$value" | cut -c 1 | tr '[:lower:]' '[:upper:]')"
  rest="$(printf "%s" "$value" | cut -c 2-)"
  printf "%s%s" "$first_char" "$rest"
}

usage() {
  cat <<'USAGE'
Usage: run_android_build.sh [options]

Options:
  --platform=android          (ignored, reserved for orchestration parity)
  --build-type=debug|release
  --variant=<productFlavor>
  --skip-tests
  --clean
  --output-dir=<path>
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --build-type=*)
      BUILD_TYPE="$(tr '[:upper:]' '[:lower:]' <<<"${arg#*=}")"
      ;;
    --variant=*)
      VARIANT="${arg#*=}"
      ;;
    --skip-tests)
      RUN_TESTS=false
      ;;
    --clean)
      CLEAN=true
      ;;
    --output-dir=*)
      OUTPUT_DIR="${arg#*=}"
      ;;
    --platform=*)
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage
      exit 1
      ;;
  esac
done

if ! install_java21_if_missing; then
  echo "Java 21 not found. Install with ./scripts/dev_bootstrap.sh or 'brew install openjdk@21'" >&2
  exit 1
fi

if ! sdk_root="$(resolve_android_sdk_root 2>/dev/null)"; then
  echo "Android SDK not found. Run ./scripts/dev_bootstrap.sh to install and configure it." >&2
  exit 1
fi
activate_android_sdk_root "$sdk_root"
if ! android_sdk_packages_installed "$ANDROID_SDK_ROOT"; then
  echo "Android SDK packages are incomplete in $ANDROID_SDK_ROOT." >&2
  echo "Run ./scripts/dev_bootstrap.sh to install required packages (platform-tools, platforms;android-35, build-tools;35.0.0)." >&2
  exit 1
fi
if ! ensure_android_local_properties "$ROOT_DIR"; then
  echo "Unable to write Android/src/local.properties with sdk.dir" >&2
  exit 1
fi

if [[ -z "$BUILD_TYPE" || "$BUILD_TYPE" != "debug" && "$BUILD_TYPE" != "release" ]]; then
  echo "Unsupported build type: ${BUILD_TYPE:-<empty>}" >&2
  exit 1
fi

BUILD_TYPE_TASK="$(capitalize_first "$BUILD_TYPE")"
TASK=":app:assemble${BUILD_TYPE_TASK}"
if [[ -n "$VARIANT" ]]; then
  TASK=":app:assemble$(capitalize_first "$VARIANT")${BUILD_TYPE_TASK}"
fi

TASKS=()
if [[ "$CLEAN" == true ]]; then
  TASKS+=( ":app:clean" )
fi
TASKS+=( "$TASK" )
if [[ "$RUN_TESTS" == true ]]; then
  TASKS+=( ":app:test${BUILD_TYPE_TASK}" )
fi

cd "$ANDROID_DIR"

./gradlew "${TASKS[@]}"

if [[ -n "$VARIANT" ]]; then
  DEFAULT_APK="$ANDROID_DIR/app/build/outputs/apk/$VARIANT/$BUILD_TYPE/app-$VARIANT-$BUILD_TYPE.apk"
else
  DEFAULT_APK="$ANDROID_DIR/app/build/outputs/apk/$BUILD_TYPE/app-$BUILD_TYPE.apk"
fi

if [[ -f "$DEFAULT_APK" ]]; then
  CREATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  if [[ -n "$OUTPUT_DIR" ]]; then
    mkdir -p "$OUTPUT_DIR"
    cp "$DEFAULT_APK" "$OUTPUT_DIR/"
    RESOLVED_ARTIFACT_PATH="$OUTPUT_DIR/$(basename "$DEFAULT_APK")"
  else
    RESOLVED_ARTIFACT_PATH="$DEFAULT_APK"
  fi
  if [[ ! -f "$RESOLVED_ARTIFACT_PATH" ]]; then
    echo "Failed to stage Android artifact at ${RESOLVED_ARTIFACT_PATH}." >&2
    exit 1
  fi

  SHA256_VALUE="$(sha256_file "$RESOLVED_ARTIFACT_PATH")"
  if [[ -z "$SHA256_VALUE" ]]; then
    echo "Unable to compute SHA-256 for artifact: ${RESOLVED_ARTIFACT_PATH}." >&2
    exit 1
  fi

  if ! emit_artifact_metadata "$RESOLVED_ARTIFACT_PATH" "$SHA256_VALUE" "$CREATED_AT"; then
    echo "Artifact metadata generation failed for ${RESOLVED_ARTIFACT_PATH}." >&2
    exit 1
  fi
else
  echo "Android APK not found at ${DEFAULT_APK}" >&2
  echo "Build output was expected at ${DEFAULT_APK}" >&2
  echo "ARTIFACT_PATH="
  exit 1
fi
