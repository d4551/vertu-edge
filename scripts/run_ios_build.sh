#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$ROOT_DIR/iOS/VertuEdge"
BUILD_TYPE="debug"
OUTPUT_DIR=""
VARIANT=""
RUN_TESTS=true
CLEAN=false
IOS_SIMULATOR_DEVICE_NAME="iPhone 14"

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
  local content_type="$4"
  if [[ -z "$artifact_path" || -z "$sha256_value" || -z "$created_at" || -z "$content_type" ]]; then
    return 1
  fi

  local size_bytes
  size_bytes="$(wc -c < "$artifact_path" | tr -d '[:space:]')"
  if [[ -z "$size_bytes" ]]; then
    echo "Unable to compute artifact size for $artifact_path" >&2
    return 1
  fi

  echo "ARTIFACT_PATH=$artifact_path"
  echo "ARTIFACT_SHA256=$sha256_value"
  echo "ARTIFACT_SIZE_BYTES=$size_bytes"
  echo "ARTIFACT_CONTENT_TYPE=$content_type"
  echo "ARTIFACT_CREATED_AT=$created_at"
  if [[ -n "${VERTU_ARTIFACT_SIGNATURE:-}" ]]; then
    echo "ARTIFACT_SIGNATURE=${VERTU_ARTIFACT_SIGNATURE}"
  fi
  echo "ARTIFACT_METADATA_JSON={\"artifactPath\":\"$artifact_path\",\"sha256\":\"$sha256_value\",\"sizeBytes\":$size_bytes,\"createdAt\":\"$created_at\",\"contentType\":\"$content_type\",\"signature\":\"${VERTU_ARTIFACT_SIGNATURE:-}\",\"correlationId\":\"${VERTU_CORRELATION_ID:-unknown}\"}"
}

normalize_artifact_output_path() {
  local raw_path="$1"
  if [[ ! -d "${OUTPUT_DIR}" ]]; then
    mkdir -p "${OUTPUT_DIR}"
  fi
  local artifact_name
  artifact_name="$(basename "$raw_path")"
  cp -R "$raw_path" "$OUTPUT_DIR/"
  echo "$OUTPUT_DIR/$artifact_name"
}

xcodebuild_works_for_developer_dir() {
  local developer_dir="$1"
  DEVELOPER_DIR="$developer_dir" "$developer_dir/usr/bin/xcodebuild" -version >/dev/null 2>&1
}

resolve_xcode_environment() {
  local selection=""
  local candidate=""
  local -a candidates=()
  local -a resolved_dirs=()

  if [[ -n "${DEVELOPER_DIR:-}" ]]; then
    candidates+=("$DEVELOPER_DIR")
  fi

  if selection="$(xcode-select -p 2>/dev/null)"; then
    if [[ -n "$selection" ]]; then
      candidates+=("$selection")
    fi
  fi

  if compgen -G "/Applications/Xcode*.app/Contents/Developer" >/dev/null; then
    for candidate in /Applications/Xcode*.app/Contents/Developer; do
      candidates+=("$candidate")
    done
  fi

  for candidate in "${candidates[@]}"; do
    if [[ -z "$candidate" || ! -x "$candidate/usr/bin/xcodebuild" ]]; then
      continue
    fi

    if xcodebuild_works_for_developer_dir "$candidate"; then
      resolved_dirs+=("$candidate")
    fi
  done

  # Prefer the first known good developer directory; remove duplicates by using first match.
  for candidate in "${resolved_dirs[@]}"; do
    XCODE_DEVELOPER_DIR="$candidate"
    XCODEBUILD_BIN="$candidate/usr/bin/xcodebuild"
    return 0
  done

  return 1
}

run_xcodebuild() {
  DEVELOPER_DIR="$XCODE_DEVELOPER_DIR" "$XCODEBUILD_BIN" "$@"
}

find_first_scheme() {
  local scheme_list="$1"
  local inside_schemes=0
  while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*Schemes: ]]; then
      inside_schemes=1
      continue
    fi

    if [[ "$inside_schemes" -ne 1 ]]; then
      continue
    fi

    if [[ "$line" =~ ^[[:space:]]*$ ]]; then
      continue
    fi

    local trimmed_line="${line#"${line%%[![:space:]]*}"}"
    trimmed_line="${trimmed_line%"${trimmed_line##*[![:space:]]}"}"

    if [[ "$trimmed_line" == *:* ]]; then
      # Another section started, no scheme lines were found.
      return 1
    fi

    if [[ "$trimmed_line" == -* ]]; then
      trimmed_line="${trimmed_line#- }"
      trimmed_line="${trimmed_line#-}"
    fi
    trimmed_line="${trimmed_line#"${trimmed_line%%[![:space:]]*}"}"

    if [[ -n "$trimmed_line" ]]; then
      echo "$trimmed_line"
      return 0
    fi
  done <<< "$scheme_list"
  return 1
}

usage() {
  cat <<'USAGE'
Usage: run_ios_build.sh [options]

Options:
  --platform=ios              (ignored, reserved for orchestration parity)
  --build-type=debug|release
  --variant=<target>
  --skip-tests
  --clean
  --output-dir=<path>
USAGE
}

if [[ "$#" -eq 0 ]]; then
  :
fi

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

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "iOS build requires macOS host." >&2
  exit 1
fi

if ! command -v swift >/dev/null 2>&1; then
  echo "swift is required on macOS hosts to build iOS packages." >&2
  exit 1
fi

if ! resolve_xcode_environment; then
  if command -v swift >/dev/null 2>&1; then
    XCODE_AVAILABLE=false
  else
    echo "No usable Xcode installation found." >&2
    echo "Install Xcode and configure a valid developer directory." >&2
    exit 1
  fi
else
  XCODE_AVAILABLE=true
fi

if [[ "$BUILD_TYPE" != "debug" && "$BUILD_TYPE" != "release" ]]; then
  echo "Unsupported build type: ${BUILD_TYPE}" >&2
  exit 1
fi

XCODEPROJ=""
while IFS= read -r candidate_path; do
  XCODEPROJ="$candidate_path"
  break
done < <(find "$IOS_DIR" -maxdepth 2 -name "*.xcodeproj" -print)
XCODEWORKSPACE=""
while IFS= read -r candidate_path; do
  XCODEWORKSPACE="$candidate_path"
  break
done < <(find "$IOS_DIR" -maxdepth 2 -name "*.xcworkspace" -print)
PACKAGE_SWIFT="$IOS_DIR/Package.swift"

if [[ "$XCODE_AVAILABLE" == "true" && ( -n "$XCODEWORKSPACE" || -n "$XCODEPROJ" ) ]]; then
  # Xcode build path: prefer workspace when present, fallback to project.
  if [[ -n "$XCODEWORKSPACE" ]]; then
    PROJECT_ARGS=(-workspace "$XCODEWORKSPACE")
  else
    PROJECT_ARGS=(-project "$XCODEPROJ")
  fi

  SCHEME="${VARIANT:-}"
  if [[ -z "$SCHEME" ]]; then
    SCHEME_OUTPUT="$(run_xcodebuild "${PROJECT_ARGS[@]}" -list)"
    if ! SCHEME="$(find_first_scheme "$SCHEME_OUTPUT")"; then
      SCHEME=""
    fi
  fi

  if [[ -z "$SCHEME" ]]; then
    echo "Unable to resolve an Xcode scheme for ${XCODEWORKSPACE}${XCODEPROJ:+ or ${XCODEPROJ}}." >&2
    echo "Run Xcode, create a shared scheme for an app target, then rerun with --variant=<scheme-name>."
    echo "SwiftPM-only trees are not buildable as iOS application artifacts from this script."
    exit 1
  fi

  DERIVED_DATA="$ROOT_DIR/iOS/build"
  CONFIGURATION="$(tr '[:lower:]' '[:upper:]' <<<"${BUILD_TYPE:0:1}")${BUILD_TYPE:1}"
  SDK="iphoneos"

  mkdir -p "$DERIVED_DATA"

  XCODE_ARGS=(
    "${PROJECT_ARGS[@]}"
    -scheme "$SCHEME"
    -configuration "$CONFIGURATION"
    -sdk "$SDK"
    -derivedDataPath "$DERIVED_DATA"
  )

  if [[ "$CLEAN" == true ]]; then
    run_xcodebuild "${XCODE_ARGS[@]}" clean >/dev/null
  fi

  run_xcodebuild "${XCODE_ARGS[@]}" build

  APP_PATH=""
  while IFS= read -r candidate_path; do
    APP_PATH="$candidate_path"
    break
  done < <(find "$DERIVED_DATA" -type d -name "*.app")
  if [[ -z "$APP_PATH" ]]; then
    echo "Unable to locate built .app bundle in ${DERIVED_DATA}." >&2
    exit 1
  fi

  FINAL_PATH="$APP_PATH"

  if [[ -n "$OUTPUT_DIR" ]]; then
    OUTPUT_PATH="$(normalize_artifact_output_path "$FINAL_PATH")"
  else
    OUTPUT_PATH="$FINAL_PATH"
  fi
  if [[ ! -d "$OUTPUT_PATH" && ! -f "$OUTPUT_PATH" ]]; then
    echo "iOS app artifact was not produced at ${OUTPUT_PATH}." >&2
    exit 1
  fi

  if [[ "$RUN_TESTS" == true ]] && [[ -f "$PACKAGE_SWIFT" ]]; then
    (cd "$IOS_DIR" && run_xcodebuild test -scheme "$SCHEME" -sdk iphonesimulator -destination "platform=iOS Simulator,name=${IOS_SIMULATOR_DEVICE_NAME}" -quiet)
  fi
else
  XCODE_AVAILABLE=false
fi

if [[ "${XCODE_AVAILABLE:-false}" == "false" ]]; then
  echo "Unable to locate an Xcode project (.xcodeproj), workspace (.xcworkspace), or valid scheme under $IOS_DIR." >&2
  exit 1
fi

CREATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
if [[ ! -d "$OUTPUT_PATH" ]]; then
  echo "Artifact path does not point to a build artifact bundle: ${OUTPUT_PATH}" >&2
  exit 1
fi

TMP_ROOT="/tmp/vertu-ios-artifacts"
mkdir -p "$TMP_ROOT"
OUTPUT_BUNDLE_NAME="$(basename "$OUTPUT_PATH")"
ARCHIVE_NAME="${OUTPUT_BUNDLE_NAME%.app}.zip"
ARCHIVE_PATH="$TMP_ROOT/$ARCHIVE_NAME"
if ! command -v zip >/dev/null 2>&1; then
  echo "zip is required to package the iOS artifact but was not found." >&2
  exit 1
fi
if ! zip -qr "$ARCHIVE_PATH" "$OUTPUT_PATH"; then
  echo "Unable to package iOS artifact as ZIP at ${ARCHIVE_PATH}." >&2
  exit 1
fi
if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "Unable to package iOS artifact as ZIP at ${ARCHIVE_PATH}." >&2
  exit 1
fi

if [[ -n "$OUTPUT_DIR" ]]; then
  mkdir -p "$OUTPUT_DIR"
  cp "$ARCHIVE_PATH" "$OUTPUT_DIR/"
  OUTPUT_PATH="$OUTPUT_DIR/$ARCHIVE_NAME"
fi

if [[ ! -f "$OUTPUT_PATH" ]]; then
  echo "Unable to stage packaged iOS artifact at ${OUTPUT_PATH}." >&2
  exit 1
fi

SHA256_VALUE="$(sha256_file "$OUTPUT_PATH")"
if [[ -z "$SHA256_VALUE" ]]; then
  echo "Unable to compute SHA-256 for artifact: ${OUTPUT_PATH}." >&2
  exit 1
fi

if ! emit_artifact_metadata "$OUTPUT_PATH" "$SHA256_VALUE" "$CREATED_AT" "application/zip"; then
  echo "Artifact metadata generation failed for ${OUTPUT_PATH}." >&2
  exit 1
fi
