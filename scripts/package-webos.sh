#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm run build
mkdir -p release
rm -f release/*.ipk
ares-package -o release dist

echo
echo "Created:"
ls -1 release/*.ipk
