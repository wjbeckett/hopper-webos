#!/usr/bin/env bash
set -euo pipefail

echo "Silo webOS - CachyOS bootstrap"
echo

if ! command -v pacman >/dev/null 2>&1; then
  echo "This helper is intended for CachyOS/Arch-based systems."
  exit 1
fi

echo "1) Installing base development packages..."
sudo pacman -S --needed nodejs npm git base-devel

echo
echo "2) Installing LG webOS CLI globally with npm..."
sudo npm install -g @webos-tools/cli

echo
echo "3) Installing project dependencies..."
npm install

echo
echo "4) Verifying toolchain..."
npm run webos:check

cat <<'EOF'

Next:
  - Install LG Developer Mode app on the TV.
  - Enable Dev Mode Status and Key Server.
  - Add TV:
      ares-setup-device
  - Retrieve key:
      ares-novacom --device livingroom --getkey
  - Deploy:
      WEBOS_DEVICE=livingroom npm run webos:deploy
EOF
