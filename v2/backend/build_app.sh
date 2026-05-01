#!/usr/bin/env bash
# build_app.sh — Maket CP desktop .app bundler.
#
# Steps:
#   1. Ensure py2app is installed.
#   2. Clean previous build/ dist/.
#   3. Run py2app via setup_py2app.py (alias mode = faster, but production
#      build uses full standalone so the bundle works on machines without
#      a matching Python install).
#   4. Ad-hoc codesign the bundle so Gatekeeper allows double-click launch
#      (no Apple Developer ID — user must "Open anyway" the first time).
#
# Usage:
#   bash v2/backend/build_app.sh           # full build
#   bash v2/backend/build_app.sh --alias   # alias build (dev only, fast)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

MODE="full"
if [[ "${1:-}" == "--alias" ]]; then
  MODE="alias"
fi

PY="${PY:-python3}"

echo "[build] Using $($PY --version) at $(command -v "$PY")"

# 1. ensure py2app
if ! "$PY" -c "import py2app" 2>/dev/null; then
  echo "[build] py2app missing — installing"
  "$PY" -m pip install py2app --break-system-packages --quiet
fi

# 2. clean previous artifacts
rm -rf build dist

# 3. run py2app
if [[ "$MODE" == "alias" ]]; then
  echo "[build] py2app (alias mode)"
  "$PY" setup_py2app.py py2app -A
else
  echo "[build] py2app (standalone)"
  "$PY" setup_py2app.py py2app --no-strip
fi

APP_PATH="dist/Maket CP.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "[build] FAIL — bundle not produced at $APP_PATH"
  exit 1
fi

# 4. ad-hoc codesign so Gatekeeper isn't actively hostile.
echo "[build] codesign --sign - --deep $APP_PATH"
codesign --force --deep --sign - "$APP_PATH"

echo "[build] OK — $APP_PATH"
echo "[build] open with: open \"$APP_PATH\""
