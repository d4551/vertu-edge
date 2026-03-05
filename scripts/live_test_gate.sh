#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPORT_DIR="$ROOT_DIR/.artifacts/live-test"
REPORT_FILE="$REPORT_DIR/live-test-gate-$(date +%Y%m%d-%H%M%S).txt"
LATEST_FILE="$REPORT_DIR/live-test-gate-latest.txt"

mkdir -p "$REPORT_DIR"

total_checks=0
failed_checks=0

run_check() {
  local label="$1"
  shift

  total_checks=$((total_checks + 1))
  echo "==> ${label}" | tee -a "$REPORT_FILE"
  if "$@" >>"$REPORT_FILE" 2>&1; then
    echo "PASS: ${label}" | tee -a "$REPORT_FILE"
  else
    echo "FAIL: ${label}" | tee -a "$REPORT_FILE"
    failed_checks=$((failed_checks + 1))
  fi
  echo "" | tee -a "$REPORT_FILE"
}

echo "Live Test Gate Report" >"$REPORT_FILE"
echo "Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$REPORT_FILE"
echo "Repository: $ROOT_DIR" >>"$REPORT_FILE"
echo "" >>"$REPORT_FILE"

run_check "control-plane typecheck" bash -lc "cd '$ROOT_DIR/control-plane' && bun run typecheck"
run_check "control-plane tests" bash -lc "cd '$ROOT_DIR/control-plane' && bun test"
run_check "capability audit" bash -lc "cd '$ROOT_DIR/control-plane' && bun run ../scripts/check-capability-gaps.ts"
run_check "code practice audit" bash -lc "cd '$ROOT_DIR/control-plane' && bun run ../scripts/check-code-practices.ts"
run_check "version freshness policy (offline)" bash -lc "cd '$ROOT_DIR' && bun run scripts/check-version-freshness.ts"
run_check "tooling typecheck" bash -lc "cd '$ROOT_DIR/tooling/vertu-flow-kit' && bun run typecheck"
run_check "tooling tests" bash -lc "cd '$ROOT_DIR/tooling/vertu-flow-kit' && bun test"

{
  echo "Summary"
  echo "- Total checks: ${total_checks}"
  echo "- Failed checks: ${failed_checks}"
  if [[ "$failed_checks" -eq 0 ]]; then
    echo "- Result: PASS"
  else
    echo "- Result: FAIL"
  fi
} | tee -a "$REPORT_FILE"

cp "$REPORT_FILE" "$LATEST_FILE"

echo "Report written to: $REPORT_FILE"
echo "Latest report symlink copy: $LATEST_FILE"

if [[ "$failed_checks" -gt 0 ]]; then
  exit 1
fi

exit 0
