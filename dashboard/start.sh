#!/usr/bin/env bash
#
# Launch the Acme Marketing Analytics Dashboard (Next.js dev server).
#
# Usage:  ./dashboard/start.sh
#         PORT=3001 ./dashboard/start.sh
#
# Installs deps on first run. Opens on localhost:3000 (or $PORT).

set -euo pipefail

cd "$(dirname "$0")"  # → dashboard/

PORT="${PORT:-3000}"

# Node version sanity check.
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not installed. Install Node ≥ 18.17 via nvm, asdf, or nodejs.org." >&2
  exit 1
fi

node_version="$(node -v | sed -e 's/^v//')"
required_major=18
required_minor=17
node_major="$(echo "$node_version" | cut -d. -f1)"
node_minor="$(echo "$node_version" | cut -d. -f2)"

if [ "$node_major" -lt "$required_major" ] || { [ "$node_major" -eq "$required_major" ] && [ "$node_minor" -lt "$required_minor" ]; }; then
  echo "ERROR: Node.js ≥ 18.17 required (found $node_version)." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "▶ Installing dependencies (one-time)..."
  # If peer-dep resolution fails (usually Recharts vs React 19),
  # we fall back to --legacy-peer-deps. Safe because the offending
  # peer ranges are cosmetic, not breaking.
  npm install || {
    echo "▶ Retrying with --legacy-peer-deps..."
    npm install --legacy-peer-deps
  }
fi

echo ""
echo "▶ Acme Marketing Analytics Dashboard"
echo "  Next.js 15 · React 19 · Tailwind · Recharts"
echo "  Open http://localhost:${PORT}"
echo "  Tell Claude (Cowork or Code) to run analytics — this view auto-refreshes every 30s."
echo ""

exec npx next dev -p "$PORT"
