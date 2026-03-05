#!/usr/bin/env bash
# Top-level dev workflow: run all dev checks and bootstrap.
# Usage: ./scripts/run_all.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Step 1: Environment check ==="
"$ROOT_DIR/scripts/dev_doctor.sh"

echo ""
echo "=== Step 2: Full bootstrap ==="
"$ROOT_DIR/scripts/dev_bootstrap.sh"

echo ""
echo "=== Done ==="
