# Hopper brand assets

Concept: poster tiles tumble into an aurora-gradient hopper (teal `#5EEAD4` → violet `#818CF8` →
rose `#F472B6`) that carries a negative-space play button; the spout glows where the picture comes
out. Background navy `#0E1030`.

## Sources (edit these)

| File | Size | Use |
|---|---|---|
| `hopper-icon.svg` | 1024×1024 | Master icon (also copied to `public/hopper-mark.svg`) |
| `hopper-splash.svg` | 1920×1080 | Launch splash / app background |
| `hopper-store-banner.svg` | 1920×1080 | Store hero / promo image |

The in-app mark (`src/components/HopperMark.tsx`) uses the same geometry with no background
(viewBox `180 110 664 840`). Change both if the artwork changes.

## Render

```sh
brand/render.sh   # needs Google Chrome + macOS sips; also copies the app assets into public/
```

## Outputs (`brand/out/`)

| File | Size | Destination |
|---|---|---|
| `app/icon.png` | 80×80 | `public/icon.png` (appinfo `icon`) |
| `app/largeIcon.png` | 130×130 | `public/largeIcon.png` (appinfo `largeIcon`) |
| `app/splash.png` | 1920×1080 | `public/splash.png` (appinfo `splashBackground`, `bgImage`) |
| `store/hopper-icon-400.png` | 400×400 | LG Seller Lounge store icon |
| `store/hopper-store-banner-1920x1080.png` | 1920×1080 | Store hero / preview image |
| `hopper-icon-1024.png` | 1024×1024 | Master raster |
| `hopper-splash-1920x1080.png` | 1920×1080 | Splash raster |

Store screenshots (1920×1080) must be taken from a running TV. They are not generated here.
Check the sizes against the current LG Seller Lounge guide before you submit.
"Hopper" has not been checked for trademark or store conflicts.
