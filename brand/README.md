# Hopper brand assets

<p align="center"><img src="out/store/hopper-icon-400.png" alt="Hopper icon" width="160"></p>

The mark shows poster tiles dropping into an aurora-gradient hopper. The hopper carries a negative-space play button, and the spout glows where the picture comes out.

| Role | Colour |
|---|---|
| Aurora gradient | teal `#5EEAD4` → violet `#818CF8` → rose `#F472B6` |
| Background | navy `#0E1030` (also `bgColor`, `iconColor` and `splashColor` in `public/appinfo.json`) |

## In the app

| Piece | File | Notes |
|---|---|---|
| Mark | `src/components/HopperMark.tsx` | Same geometry as `hopper-icon.svg` with no background (viewBox `180 110 664 840`). Gradient IDs come from `useId`. |
| Nav lockup | `HopperLockup` in the same file | 30×38 mark plus wordmark, in the top nav |
| Startup animation | `src/components/StartupSplash.tsx` and `src/styles.css` | The hopper settles, three tiles fall in one at a time and the hopper dips as each lands, the play button pops, then the spout glow spreads as the wordmark rises. `public/splash.png` (LG's native launch splash) is the same backdrop with no artwork, so the animation starts from an empty stage. The resting frame matches `hopper-splash.svg`. |

If you change the artwork, update the SVG and `HopperMark.tsx` together.

## Sources (edit these)

| File | Size | Use |
|---|---|---|
| `hopper-icon.svg` | 1024×1024 | Master icon (also copied to `public/hopper-mark.svg`) |
| `hopper-splash.svg` | 1920×1080 | Full splash artwork: backdrop, mark and wordmark. Reference for the resting frame of the startup animation |
| `hopper-splash-backdrop.svg` | 1920×1080 | The same backdrop with no mark or wordmark: LG's native launch splash. Keep its gradients identical to `hopper-splash.svg` and `.startup-splash` in `src/styles.css` |
| `hopper-store-banner.svg` | 1920×1080 | Store hero / promo image |

## Render

```sh
brand/render.sh   # needs Google Chrome + macOS sips; also copies the app assets into public/
```

## Outputs (`brand/out/`)

| File | Size | Destination |
|---|---|---|
| `app/icon.png` | 80×80 | `public/icon.png` (appinfo `icon`) |
| `app/largeIcon.png` | 130×130 | `public/largeIcon.png` (appinfo `largeIcon`) |
| `app/splash.png` | 1920×1080 | `public/splash.png` (appinfo `splashBackground`, `bgImage`), rendered from `hopper-splash-backdrop.svg` |
| `store/hopper-icon-400.png` | 400×400 | LG Seller Lounge store icon |
| `store/hopper-store-banner-1920x1080.png` | 1920×1080 | Store hero / preview image |
| `hopper-icon-1024.png` | 1024×1024 | Master raster |
| `hopper-splash-1920x1080.png` | 1920×1080 | Full splash artwork raster (not shipped in the app) |

## Store screenshots (`store/screenshots/`)

Taken on an LG TV (webOS 22) against the public demo server (`demo.siloserver.org`, demo/demo), so no
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
