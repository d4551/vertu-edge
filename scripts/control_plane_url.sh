#!/usr/bin/env bash
# Output the Vertu Control Plane URL. Uses bun to resolve port from config (no hardcoding).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
PORT="${CONTROL_PLANE_PORT:-$(bun -e 'import { resolveControlPlanePort } from "./control-plane/src/config"; console.log(resolveControlPlanePort());')}"
echo "http://localhost:${PORT}"
