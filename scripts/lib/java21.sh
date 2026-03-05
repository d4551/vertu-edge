#!/usr/bin/env bash

# Shared Java 21 resolver for local scripts.
# Prefers an already-configured JAVA_HOME, then macOS java_home, then Homebrew openjdk@21.

JAVA21_BREW_FORMULA="${JAVA21_BREW_FORMULA:-openjdk@21}"

java21_log() {
  printf '[java21] %s\n' "$1"
}

java21_major_from_home() {
  local java_home="$1"
  if [[ ! -x "$java_home/bin/java" ]]; then
    return 1
  fi
  "$java_home/bin/java" -version 2>&1 | awk -F '"' '/version/ {print $2}' | cut -d. -f1
}

resolve_java21_home() {
  if [[ -n "${JAVA_HOME:-}" ]]; then
    local existing_major=""
    if existing_major="$(java21_major_from_home "$JAVA_HOME" 2>/dev/null)"; then
      :
    fi
    if [[ "$existing_major" == "21" ]]; then
      echo "$JAVA_HOME"
      return 0
    fi
  fi

  if command -v /usr/libexec/java_home >/dev/null 2>&1; then
    local system_home=""
    if system_home="$(/usr/libexec/java_home -v 21 2>/dev/null)"; then
      :
    fi
    if [[ -n "$system_home" && -x "$system_home/bin/java" ]]; then
      echo "$system_home"
      return 0
    fi
  fi

  if command -v brew >/dev/null 2>&1; then
    local brew_prefix=""
    if brew_prefix="$(brew --prefix "$JAVA21_BREW_FORMULA" 2>/dev/null)"; then
      :
    fi
    if [[ -n "$brew_prefix" ]]; then
      if [[ -x "$brew_prefix/bin/java" ]]; then
        echo "$brew_prefix"
        return 0
      fi
      if [[ -x "$brew_prefix/libexec/openjdk.jdk/Contents/Home/bin/java" ]]; then
        echo "$brew_prefix/libexec/openjdk.jdk/Contents/Home"
        return 0
      fi
    fi
  fi

  return 1
}

activate_java21_home() {
  local java_home="$1"
  export JAVA_HOME="$java_home"
  case ":$PATH:" in
    *":$JAVA_HOME/bin:"*) ;;
    *) export PATH="$JAVA_HOME/bin:$PATH" ;;
  esac
}

ensure_java21_available() {
  local java_home
  java_home="$(resolve_java21_home)" || return 1
  activate_java21_home "$java_home"
  local major=""
  if major="$(java21_major_from_home "$JAVA_HOME" 2>/dev/null)"; then
    :
  fi
  [[ "$major" == "21" ]]
}

install_java21_if_missing() {
  if ensure_java21_available; then
    return 0
  fi
  if ! command -v brew >/dev/null 2>&1; then
    return 1
  fi
  java21_log "Java 21 not found. Installing $JAVA21_BREW_FORMULA via Homebrew formula."
  brew install "$JAVA21_BREW_FORMULA"
  ensure_java21_available
}
