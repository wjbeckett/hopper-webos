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

## Store screenshots (`store/screenshots/`)

Taken on BedroomTV against the public demo server (`demo.siloserver.org`, demo/demo), so no
personal library appears. Content is open movies (Sintel, Big Buck Bunny) and public-domain titles.

| File | Size | Screen |
|---|---|---|
| `01-home.png` | 1920×1080 | Home: Sintel hero, Continue Watching |
| `02-details.png` | 1920×1080 | Sintel details: Resume, time-left ring, cast |
| `03-movies.png` | 1920×1080 | Movies: poster row |
| `04-series.png` | 1920×1080 | Series: The Lucy Show hero |

Playback can't be captured over the inspector, because webOS plays video on a hardware layer the
page screenshot doesn't include. To include a player shot, use the TV's own capture.

The draft listing text is in `store/LISTING.md`.
Check the sizes against the current LG Seller Lounge guide before you submit.
"Hopper" has not been checked for trademark or store conflicts.
