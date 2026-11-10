#!/usr/bin/env bash
# Render the Hopper brand SVGs to every PNG the app and LG Seller Lounge need.
# Requires Google Chrome (headless) and macOS `sips`. Run from anywhere: brand/render.sh
set -euo pipefail

BRAND="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$BRAND/.." && pwd)"
OUT="$BRAND/out"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT/app" "$OUT/store"

# render <svg> <width> <height> <png>: exact-size raster via headless Chrome.
render() {
  local svg="$1" w="$2" h="$3" png="$4"
  local html="$TMP/$(basename "$png").html"
  printf '<!doctype html><html><head><style>html,body{margin:0;background:transparent}img{display:block;width:%spx;height:%spx}</style></head><body><img src="file://%s"></body></html>' "$w" "$h" "$svg" > "$html"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$w,$h" \
    --screenshot="$png" "file://$html" >/dev/null 2>&1
}

# Master renders.
render "$BRAND/hopper-icon.svg" 1024 1024 "$OUT/hopper-icon-1024.png"
render "$BRAND/hopper-splash.svg" 1920 1080 "$OUT/hopper-splash-1920x1080.png"
render "$BRAND/hopper-store-banner.svg" 1920 1080 "$OUT/store/hopper-store-banner-1920x1080.png"

# Downscales from the 1024 master (sharper than rasterising tiny sizes directly).
scale() { sips -z "$2" "$2" "$OUT/hopper-icon-1024.png" --out "$3" >/dev/null; }
scale x 400 "$OUT/store/hopper-icon-400.png"    # LG Seller Lounge store icon
scale x 130 "$OUT/app/largeIcon.png"            # appinfo largeIcon
scale x 80  "$OUT/app/icon.png"                 # appinfo icon
cp "$OUT/hopper-splash-1920x1080.png" "$OUT/app/splash.png"   # appinfo splashBackground

# Install the app assets into the package.
cp "$OUT/app/icon.png" "$OUT/app/largeIcon.png" "$OUT/app/splash.png" "$ROOT/public/"
echo "Rendered:"; find "$OUT" -name '*.png' | sort | while read -r f; do echo "  ${f#$ROOT/} $(sips -g pixelWidth -g pixelHeight "$f" | awk '/pixel/{printf "%s ", $2}')"; done
