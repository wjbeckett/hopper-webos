# Hopper brand assets

<p align="center"><img src="out/store/hopper-icon-400.png" alt="Hopper icon" width="160"></p>

> [!IMPORTANT]
> This artwork is not under the AGPL. It is © the Hopper maintainer, all rights reserved (see [`NOTICE`](NOTICE) and [`TRADEMARK.md`](../TRADEMARK.md)). A fork you distribute must replace it.

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
| Startup animation | `index.html` (markup, styles and timeline) and `src/core/bootSplash.ts` (when to lift it) | The hopper settles, three tiles fall in one at a time and the hopper dips as each lands, the play button pops, then the spout glow spreads as the wordmark rises. Each moving part is its own HTML element so the TV's compositor animates it while the app loads. `public/splash.png` (LG's native launch splash) is the same backdrop with no artwork, so the animation starts from an empty stage. The resting frame matches `hopper-splash.svg`. |

If you change the artwork, update the SVG, `HopperMark.tsx` and the splash layers in `index.html` together.

## Sources (edit these)

| File | Size | Use |
|---|---|---|
| `hopper-icon.svg` | 1024×1024 | Master icon |
| `hopper-splash.svg` | 1920×1080 | Full splash artwork: backdrop, mark and wordmark. Reference for the resting frame of the startup animation |
| `hopper-splash-backdrop.svg` | 1920×1080 | The same backdrop with no mark or wordmark: LG's native launch splash. Keep its gradients identical to `hopper-splash.svg` and `#boot-splash` in `index.html` |
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
The demo server also has clips named after Dolby, Netflix and LG; keep them out of the shots (frame
Home on a Recently Added row, and filter Movies → Browse to a genre such as Drama).

| File | Size | Screen |
|---|---|---|
| `01-home.png` | 1920×1080 | Home: Sintel hero, Recently Added in Movies |
| `02-details.png` | 1920×1080 | Sintel details: Resume, time-left ring, version, cast, trailers |
| `03-movies.png` | 1920×1080 | Movies → Browse filtered to Drama: sort, filter, poster grid |
| `04-series.png` | 1920×1080 | The Lucy Show series page: Play next episode, season tab, episode row |
| `05-player.png` | 1920×1080 | Sintel paused at 0:32 with the player controls (composite, see below) |

The page shots are inspector captures (`Page.captureScreenshot`) with the app's page focused. If the
page has lost system focus (`document.hasFocus()` false, which happens after a few idle minutes),
focus rings don't draw: restart the app and take the shot again.

webOS plays video on a hardware layer that page captures leave out, and the TV refuses screen capture
to apps (`com.webos.service.capture` denies `executeOneShot`). `05-player.png` is therefore a
composite of two real parts: the player UI captured on the TV with a transparent background (page and
`.player-shell` backgrounds cleared, video hidden, `Emulation.setDefaultBackgroundColorOverride` alpha
0), laid over the same file's frame at the same position (0:32.303), rendered by desktop Chrome with
`object-fit: contain` at 1920×1080 as the TV shows it. The demo copy of Sintel is 564×240, so the
picture is as soft as it is on the TV.

The draft listing text is in `store/LISTING.md`.
Check the sizes against the current LG Seller Lounge guide before you submit.
"Hopper" has not been checked for conflicts with existing trademarks or store listings. `TRADEMARK.md` claims only unregistered (™) rights.
