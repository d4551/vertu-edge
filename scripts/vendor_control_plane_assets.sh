#!/usr/bin/env bash
# Vendor control-plane static assets from npm registry (NO CDN).
# Uses bun add to fetch from registry.npmjs.org; copies from node_modules to public/.
# Local files are served with correct Content-Type by the control-plane server.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC="$ROOT/control-plane/public"
VENDOR_DIR="${VENDOR_DIR:-$ROOT/.vendor-assets}"

log() { printf '[vendor-assets] %s\n' "$1"; }

# Resolve latest versions from npm registry (no CDN)
resolve_version() {
  bun pm view "$1" version 2>/dev/null || echo ""
}

DAISYUI_VER="${DAISYUI_VER:-$(resolve_version daisyui)}"
HTMX_VER="${HTMX_VER:-$(resolve_version htmx.org)}"
TAILWIND_VER="${TAILWIND_VER:-$(resolve_version @tailwindcss/browser)}"
HTMX_SSE_EXT_VER="${HTMX_SSE_EXT_VER:-$(resolve_version htmx-ext-sse)}"

[[ -z "$DAISYUI_VER" ]] && DAISYUI_VER="5.5.19"
[[ -z "$HTMX_VER" ]] && HTMX_VER="2.0.8"
[[ -z "$TAILWIND_VER" ]] && TAILWIND_VER="4.2.1"
[[ -z "$HTMX_SSE_EXT_VER" ]] && HTMX_SSE_EXT_VER="2.2.4"

log "Resolved: daisyui@$DAISYUI_VER htmx.org@$HTMX_VER htmx-ext-sse@$HTMX_SSE_EXT_VER @tailwindcss/browser@$TAILWIND_VER"

mkdir -p "$PUBLIC" "$VENDOR_DIR"
cd "$VENDOR_DIR"

# Install from npm registry only (registry.npmjs.org — not a CDN)
log "Installing from npm registry (no CDN)..."
bun add "daisyui@$DAISYUI_VER" "htmx.org@$HTMX_VER" "htmx-ext-sse@$HTMX_SSE_EXT_VER" "@tailwindcss/browser@$TAILWIND_VER"

# Copy daisyui.css
if [[ -f "node_modules/daisyui/daisyui.css" ]]; then
  cp "node_modules/daisyui/daisyui.css" "$PUBLIC/daisyui.css"
  log "Vendored daisyui.css ($(wc -c < "$PUBLIC/daisyui.css") bytes) — daisyui@$DAISYUI_VER"
else
  log "ERROR: daisyui/daisyui.css not found"
  exit 1
fi

# Copy htmx.min.js
if [[ -f "node_modules/htmx.org/dist/htmx.min.js" ]]; then
  cp "node_modules/htmx.org/dist/htmx.min.js" "$PUBLIC/htmx.min.js"
  log "Vendored htmx.min.js ($(wc -c < "$PUBLIC/htmx.min.js") bytes) — htmx.org@$HTMX_VER"
else
  log "ERROR: htmx.org/dist/htmx.min.js not found"
  exit 1
fi

# Copy @tailwindcss/browser (index.global.js → tailwindcss-browser.js)
if [[ -f "node_modules/@tailwindcss/browser/dist/index.global.js" ]]; then
  cp "node_modules/@tailwindcss/browser/dist/index.global.js" "$PUBLIC/tailwindcss-browser.js"
  log "Vendored tailwindcss-browser.js ($(wc -c < "$PUBLIC/tailwindcss-browser.js") bytes) — @tailwindcss/browser@$TAILWIND_VER"
else
  log "ERROR: @tailwindcss/browser/dist/index.global.js not found"
  exit 1
fi

# Copy htmx-ext-sse plugin (sse.min.js → htmx-ext-sse.min.js)
if [[ -f "node_modules/htmx-ext-sse/dist/sse.min.js" ]]; then
  cp "node_modules/htmx-ext-sse/dist/sse.min.js" "$PUBLIC/htmx-ext-sse.min.js"
  log "Vendored htmx-ext-sse.min.js ($(wc -c < "$PUBLIC/htmx-ext-sse.min.js") bytes) — htmx-ext-sse@$HTMX_SSE_EXT_VER"
else
  log "ERROR: htmx-ext-sse/dist/sse.min.js not found"
  exit 1
fi

log "Done. Assets in $PUBLIC served locally (no CDN)."
log "Versions: daisyui@$DAISYUI_VER htmx.org@$HTMX_VER htmx-ext-sse@$HTMX_SSE_EXT_VER @tailwindcss/browser@$TAILWIND_VER"
