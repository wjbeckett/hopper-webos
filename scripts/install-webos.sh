#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEVICE="${WEBOS_DEVICE:-livingroom}"
IPK="$(find "$ROOT/release" -maxdepth 1 -name '*.ipk' -print -quit)"

if [[ -z "${IPK:-}" ]]; then
  echo "No IPK found. Run: npm run webos:package"
  exit 1
fi

ares-install --device "$DEVICE" "$IPK"
