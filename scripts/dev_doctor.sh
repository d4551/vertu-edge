#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/java21.sh"
source "$ROOT_DIR/scripts/lib/android_sdk.sh"

print_status() {
  local name="$1"
  local status="$2"
  printf '%-28s %s\n' "$name" "$status"
}

check_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    print_status "$cmd" "OK"
  else
    print_status "$cmd" "MISSING"
  fi
}

check_cmd bun
check_cmd swift
check_cmd brew
check_cmd python3

if ensure_java21_available; then
  print_status "java_runtime" "OK"
  print_status "java_home_21" "$JAVA_HOME"
else
  print_status "java_runtime" "MISSING"
  print_status "java_home_21" "NOT FOUND"
fi

if [[ -f "$ROOT_DIR/contracts/flow-v1.schema.json" ]]; then
  print_status "contracts" "OK"
else
  print_status "contracts" "MISSING"
fi

if [[ -f "$ROOT_DIR/Android/src/vertu.local.properties.example" ]]; then
  print_status "android_env_template" "OK"
else
  print_status "android_env_template" "MISSING"
fi

if sdk_root="$(resolve_android_sdk_root 2>/dev/null)"; then
  print_status "android_sdk_root" "$sdk_root"
else
  print_status "android_sdk_root" "NOT FOUND"
fi

if command -v ramalama >/dev/null 2>&1; then
  print_status "ramalama" "OK (optional)"
else
  print_status "ramalama" "MISSING (optional)"
fi

if command -v ollama >/dev/null 2>&1; then
  print_status "ollama" "OK (optional)"
else
  print_status "ollama" "MISSING (optional)"
fi

printf '\nRun full verification with: %s\n' "$ROOT_DIR/scripts/dev_bootstrap.sh"
