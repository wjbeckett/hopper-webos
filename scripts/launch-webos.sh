#!/usr/bin/env bash
set -euo pipefail

DEVICE="${WEBOS_DEVICE:-livingroom}"
APP_ID="${WEBOS_APP_ID:-com.hopperapp.hopper}"

ares-launch --device "$DEVICE" "$APP_ID"
