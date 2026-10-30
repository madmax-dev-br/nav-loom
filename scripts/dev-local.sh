#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Install Node.js 22.13+ and npm, and make them available on PATH." >&2
  exit 1
fi
exec npm run dev -- "$@"
