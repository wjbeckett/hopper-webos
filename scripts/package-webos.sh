#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm run build
mkdir -p release
rm -f release/*.ipk
# The second path bundles the companion-pairing JS service into the IPK.
ares-package -o release dist services/pairing

echo
echo "Created:"
ls -1 release/*.ipk
