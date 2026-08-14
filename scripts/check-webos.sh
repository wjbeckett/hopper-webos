#!/usr/bin/env bash
set -euo pipefail

for cmd in node npm ares-package ares-install ares-launch ares-setup-device; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing: $cmd"
    exit 1
  fi
done

echo "Node: $(node --version)"
echo "npm:  $(npm --version)"
echo "webOS CLI:"
ares --version || true
echo
echo "Devices:"
ares-setup-device --list || true
