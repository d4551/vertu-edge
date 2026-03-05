#!/usr/bin/env bash

# Shared Android SDK resolver/provisioner for local scripts.

ANDROID_SDK_DEFAULT_BREW_ROOT="/opt/homebrew/share/android-commandlinetools"
ANDROID_SDK_DEFAULT_PLATFORM="platforms;android-35"
ANDROID_SDK_DEFAULT_BUILD_TOOLS="build-tools;35.0.0"

android_sdk_log() {
  printf '[android-sdk] %s\n' "$1"
}

resolve_android_sdk_root() {
  if [[ -n "${ANDROID_SDK_ROOT:-}" && -d "${ANDROID_SDK_ROOT}" ]]; then
    echo "${ANDROID_SDK_ROOT}"
    return 0
  fi
  if [[ -n "${ANDROID_HOME:-}" && -d "${ANDROID_HOME}" ]]; then
    echo "${ANDROID_HOME}"
    return 0
  fi
  if [[ -d "$HOME/Library/Android/sdk" ]]; then
    echo "$HOME/Library/Android/sdk"
    return 0
  fi
  if [[ -d "$HOME/Android/Sdk" ]]; then
    echo "$HOME/Android/Sdk"
    return 0
  fi
  if [[ -d "$ANDROID_SDK_DEFAULT_BREW_ROOT" ]]; then
    echo "$ANDROID_SDK_DEFAULT_BREW_ROOT"
    return 0
  fi
  return 1
}

resolve_sdkmanager_path() {
  local sdk_root="$1"
  local candidates=(
    "$sdk_root/cmdline-tools/latest/bin/sdkmanager"
    "$sdk_root/tools/bin/sdkmanager"
  )
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  if command -v sdkmanager >/dev/null 2>&1; then
    command -v sdkmanager
    return 0
  fi
  return 1
}

activate_android_sdk_root() {
  local sdk_root="$1"
  export ANDROID_SDK_ROOT="$sdk_root"
  export ANDROID_HOME="$sdk_root"
}

android_sdk_packages_installed() {
  local sdk_root="$1"
  [[ -d "$sdk_root/platform-tools" ]] \
    && [[ -d "$sdk_root/platforms/android-35" ]] \
    && [[ -d "$sdk_root/build-tools/35.0.0" ]]
}

install_android_sdk_if_missing() {
  local sdk_root
  if ! sdk_root="$(resolve_android_sdk_root 2>/dev/null)"; then
    sdk_root=""
  fi
  if [[ -z "$sdk_root" ]]; then
    if ! command -v brew >/dev/null 2>&1; then
      return 1
    fi
    android_sdk_log "Android SDK not found. Installing android-commandlinetools via Homebrew cask."
    brew install --cask android-commandlinetools
    sdk_root="$ANDROID_SDK_DEFAULT_BREW_ROOT"
  fi

  if [[ ! -d "$sdk_root" ]]; then
    return 1
  fi

  activate_android_sdk_root "$sdk_root"
  if android_sdk_packages_installed "$sdk_root"; then
    return 0
  fi

  local sdkmanager
  if ! sdkmanager="$(resolve_sdkmanager_path "$sdk_root" 2>/dev/null)"; then
    sdkmanager=""
  fi
  if [[ -z "$sdkmanager" ]]; then
    return 1
  fi

  android_sdk_log "Installing required Android SDK packages in $sdk_root"
  if ! yes | "$sdkmanager" --sdk_root="$sdk_root" --licenses >/dev/null; then
    android_sdk_log "Failed accepting Android SDK licenses."
    return 1
  fi
  "$sdkmanager" --sdk_root="$sdk_root" \
    "platform-tools" \
    "$ANDROID_SDK_DEFAULT_PLATFORM" \
    "$ANDROID_SDK_DEFAULT_BUILD_TOOLS"

  android_sdk_packages_installed "$sdk_root"
}

ensure_android_local_properties() {
  local repo_root="$1"
  local android_project_dir="$repo_root/Android/src"
  local local_properties="$android_project_dir/local.properties"

  local sdk_root
  sdk_root="$(resolve_android_sdk_root)" || return 1
  activate_android_sdk_root "$sdk_root"

  if [[ ! -d "$android_project_dir" ]]; then
    return 1
  fi

  printf 'sdk.dir=%s\n' "${sdk_root//\//\\/}" >"$local_properties"
}
