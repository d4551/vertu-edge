#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_CONTROL_PLANE_PORT="$(bun -e 'import { CONTROL_PLANE_DEFAULT_PORT } from "./control-plane/src/config"; console.log(CONTROL_PLANE_DEFAULT_PORT);')"
PORT="${CONTROL_PLANE_PORT:-${DEFAULT_CONTROL_PLANE_PORT}}"

cd "$ROOT_DIR/control-plane"

if [[ ! -d node_modules ]]; then
  bun install
fi

CONTROL_PLANE_PORT="$PORT" bun run src/index.ts
