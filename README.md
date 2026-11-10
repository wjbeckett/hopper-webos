<p align="center">
  <img src="brand/out/store/hopper-store-banner-1920x1080.png" alt="Hopper for LG webOS" width="100%">
</p>

<p align="center">
  <img src="brand/out/store/hopper-icon-400.png" alt="Hopper icon" width="96"><br>
  <strong>Hopper</strong> · a remote-first Silo client for LG TVs<br>
  <code>com.hopperapp.hopper</code> · v0.3.0 · React 19 + TypeScript + Vite
</p>

# Hopper for LG webOS

Hopper is an independent, community-built LG webOS TV client for the [Silo](https://silo.tv/) self-hosted media server. It is not affiliated with or endorsed by the Silo project; "Silo" and the Silo logo are trademarks of their owners and are used here only to describe compatibility. It is designed as a 10-foot interface: every primary action is usable with a TV remote, while mouse and keyboard support make browser development convenient.

> [!IMPORTANT]
> This project is under active development. The store assets and a draft LG Content Store listing are ready (see [Store submission](#store-submission)), but publishing is blocked on trademark and permission checks. Playback still needs testing across several LG webOS generations, and many workflows have only been build-checked.

## Screenshots

| Home | Details |
| --- | --- |
| ![Home](brand/store/screenshots/01-home.png) | ![Details](brand/store/screenshots/02-details.png) |
| **Movies** | **Series** |
| ![Movies](brand/store/screenshots/03-movies.png) | ![Series](brand/store/screenshots/04-series.png) |

These were captured on an LG TV against the public Silo demo server (`demo.siloserver.org`), using public-domain and Blender open-movie content.

## Highlights

- Native Silo device/QR sign-in, with username and password as a fallback
- Multiple saved Silo servers and locally persisted sessions
- Profile-aware home layout, libraries, favorites, and watchlist
- Focused-item home artwork backdrop with TV-safe crossfades
- Movies, TV, music, and audiobook library surfaces; audiobook detail uses a book-specific poster-led hero and resume/restart actions
- Library Browse with catalog-backed sorting, facets, server-side A–Z prefix, remembered sort/filters, and TV-remote-friendly filter panels
- Per-library Collections (grouped, with collection detail), audiobook Authors/Series, A–Z, empty-library states, and server-backed Shuffle for libraries and collections
- Series, season, and episode navigation with profile-driven unwatched-episode spoiler protection
- Detail-page theme music with profile enable/loop settings and fade/interruption handling
- Calendar releases, collections, watch history, and request workflows
- Household profile switching with PIN verification
- Continue Watching and other server-defined home rails, refreshed live from the server's realtime events socket (user_state/catalog), with a polling fallback
- Watch state (watched, favorite, watchlist, resume position) updates cards and rails in place without refetching
- Debounced catalog search
- D-pad spatial navigation and LG Back-key handling
- Protocol-v3 playback planning and replanning
- HLS playback with negotiated request headers
- Resume with configurable rewind, intro skip mode, automatic credits skipping, Up Next card at the credits with auto-play countdown and Still Watching gate, shuffle Up Next (Pick Another / Stop shuffling), seek, chapter markers, and playback progress reporting
- Audio track, subtitle track, file version, and quality selection
- Profile appearance themes and text preferences
- Android TV-style Settings for General, Playback, Subtitles, local Diagnostics log viewing/ZIP export, and Server; diagnostic logs remain on-device and are never uploaded to Silo
- Time-left ring on Continue Watching, the Home hero and the Details metadata row
- Startup splash animated over a pre-rendered Home, matching the native LG launch splash
- Build, package, install, launch, and inspect helpers for LG TVs

## Project status

The current version is `0.3.0`: app ID `com.hopperapp.hopper`, pairing service `com.hopperapp.hopper.service`.

| Area | State |
| --- | --- |
| Core browsing (Home, libraries, Browse, Details, Series, Search) | Implemented; Home, Browse, Details and Continue Watching tuned and checked on a physical TV (webOS, Chrome 87) |
| Playback (protocol v3, HLS, tracks, skip markers, Up Next) | Implemented; daily use on one TV, codec matrix across webOS generations not qualified |
| Profiles (pick, PIN, create, edit, delete) | Implemented; create/edit/delete build-checked only |
| Audiobooks | Detail hero done; dedicated multi-part audio player outstanding |
| Hopper brand (icon, splash, store art) | Done and verified on TV |
| Store listing and screenshots | Drafted; submission blocked on the [pre-submit checklist](brand/store/LISTING.md#before-you-submit) |
| Automated tests | None yet |

Detailed status:

- [`docs/FIRST_GRADE_ROADMAP.md`](docs/FIRST_GRADE_ROADMAP.md): verified features, release blockers and the change log.
- [`docs/ANDROID_PARITY_TODO.md`](docs/ANDROID_PARITY_TODO.md): prioritised Android TV parity gaps.
- [`docs/HANDOFF.md`](docs/HANDOFF.md): current state and next steps for whoever picks the work up next.

## Tech stack

- React 19
- TypeScript 5.7
- Vite 6
- `hls.js` for HLS playback where native execution is unavailable
- `qrcode` for device-login pairing
- LG `@webos-tools/cli` for packaging and deployment

## Requirements

For browser development:

- Node.js and npm
- A reachable Silo server

For TV deployment:

- An LG webOS TV with the **Developer Mode** app installed
- An LG developer account
- LG's [`@webos-tools/cli`](https://www.npmjs.com/package/@webos-tools/cli)
- A workstation and TV on the same network

The included bootstrap script targets CachyOS and other Arch-based distributions. Other operating systems can use the same npm commands after installing Node.js and the webOS CLI manually.

## Quick start

Install dependencies:

```bash
npm install
```

Point the Vite development proxy at your Silo server and start the app:

```bash
SILO_DEV_SERVER=https://silo.example.com npm run dev
```

Open the URL printed by Vite. Use the arrow keys to move focus, Enter to select, and Escape or Backspace to go back.

The development server proxies `/__silo` to `SILO_DEV_SERVER`. This keeps browser requests same-origin and avoids changing production server handling. Use a server URL that is reachable from the development workstation. Self-signed HTTPS certificates are accepted by the proxy during local development.

## CachyOS / Arch setup

The setup helper installs the system packages, webOS CLI, and project dependencies, then checks the toolchain:

```bash
chmod +x scripts/*.sh
./scripts/setup-cachyos.sh
```

The equivalent manual setup is:

```bash
sudo pacman -S --needed nodejs npm git base-devel
sudo npm install -g @webos-tools/cli
npm install
npm run webos:check
```

## Connect an LG TV

On the TV:

1. Install **Developer Mode** from the LG Content Store.
2. Sign in with an LG developer account.
3. Enable **Dev Mode Status** and **Key Server**.
4. Note the TV's IP address and the passphrase shown by the app.

On the development workstation, register the TV:

```bash
ares-setup-device
```

Choose a device name such as `livingroom`, then retrieve its developer key:

```bash
ares-novacom --device livingroom --getkey
```

Confirm that the TV is reachable:

```bash
ares-device-info --device livingroom
```

Developer Mode certificates expire. If deployment suddenly stops working, reopen the Developer Mode app, extend the session, and retrieve the key again if required.

## Build and deploy

Create a production build:

```bash
npm run build
```

Package it as an IPK in `release/`:

```bash
npm run webos:package
```

Build, package, install, and launch in one command:

```bash
WEBOS_DEVICE=livingroom npm run webos:deploy
```

`WEBOS_DEVICE` defaults to `livingroom`. The application ID defaults to `com.hopperapp.hopper`; override it for launch and inspection with `WEBOS_APP_ID` if you change `public/appinfo.json`.

To open LG's Web Inspector for the installed application:

```bash
WEBOS_DEVICE=livingroom npm run webos:inspect
```

## Available commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server on all interfaces |
| `npm run build` | Type-check and create the production build in `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run webos:check` | Verify Node, npm, LG CLI tools, and configured devices |
| `npm run webos:package` | Build and package an IPK into `release/` |
| `npm run webos:install` | Install the first IPK in `release/` on the configured TV |
| `npm run webos:launch` | Launch the application on the configured TV |
| `npm run webos:deploy` | Package, install, and launch the application |
| `npm run webos:inspect` | Open Web Inspector for the application |

## Sign-in flow

Device sign-in is the primary TV experience and uses Silo's native API:

```text
POST /api/v2/auth/device/start
              │
              ├─ TV displays the QR code and pairing code
              │
              ├─ user approves the request in Silo
              │
              └─ POST /api/v2/auth/device/poll
                         │
                         └─ access token, refresh token, and profile context
```

The approved poll response is captured immediately because the server returns token fields only on the first successful poll. Username/password login remains available from **Use password instead**.

Saved server details, session tokens, pending pairing state, and navigation state are stored in webOS browser `localStorage`. Treat a Developer Mode TV as a trusted device and sign out or remove the application before transferring it.

## Playback architecture

Playback is negotiated with Silo rather than assembled from ad hoc media URLs:

```text
LG media capability probe
          ↓
Silo playback-v3 start request
          ↓
direct play / remux / transcode decision
          ↓
negotiated HLS plan
          ↓
HTMLMediaElement + hls.js
          ↓
progress, stop, seek, quality, and track replanning
```

The client advertises codecs based on `HTMLMediaElement.canPlayType()`. Original-file and progressive delivery are currently disabled in its device profile because LG's browser can report codec support while rejecting the source container. The server is asked to produce a compatible HLS route instead.

Only Silo's native API is used. Jellyfin-compatible endpoints, headers, models, and playback URLs are intentionally out of scope.

## Project structure

```text
brand/                   Hopper SVG sources, render.sh, rendered PNGs, store listing and screenshots
public/                  webOS metadata (appinfo.json), icons, splash, fonts
scripts/                 setup, packaging, deployment, and inspection helpers
src/api/                 native Silo API and playback contracts
src/components/          reusable 10-foot UI components
src/core/                server and session registry
src/navigation/          remote/spatial focus behavior
src/platform/            LG webOS capabilities and device behavior
src/screens/             application screens and player UI
docs/                    roadmap and project documentation
```

Architecture boundaries are deliberate: API access belongs in `src/api`, LG-specific behavior in `src/platform`, and remote focus logic in `src/navigation`. UI components should not contain raw API URLs.

## Branding

The Hopper mark shows poster tiles dropping into an aurora-gradient hopper (teal `#5EEAD4` to violet `#818CF8` to rose `#F472B6`). The hopper carries a negative-space play button, on a navy `#0E1030` background.

| What | Where |
| --- | --- |
| SVG sources | `brand/hopper-icon.svg`, `brand/hopper-splash.svg`, `brand/hopper-store-banner.svg` |
| Render pipeline | `brand/render.sh` (headless Google Chrome + macOS `sips`), which also copies `icon.png`, `largeIcon.png` and `splash.png` into `public/` |
| In-app mark | `src/components/HopperMark.tsx` (same geometry, viewBox `180 110 664 840`), plus `HopperLockup` in the top nav |
| Startup animation | `src/components/StartupSplash.tsx`; its resting frame lines up with `public/splash.png` |

If you change the artwork, edit the SVG and `HopperMark.tsx` together, then run `brand/render.sh`. See [`brand/README.md`](brand/README.md).

## Store submission

Everything for the LG Content Store is in `brand/`:

- Store icon (400×400) and hero banner (1920×1080) in `brand/out/store/`
- Four 1920×1080 screenshots in `brand/store/screenshots/`
- A draft listing, the reviewer test account and a pre-submit checklist in [`brand/store/LISTING.md`](brand/store/LISTING.md)

Publishing is blocked until these are done:

1. The demo server operator agrees that LG reviewers can use `demo`/`demo`, and keeps the server up during review.
2. Permission to name Silo in the listing.
3. A check of the asset specs against the current LG Seller Lounge guide.
4. Trademark and store-name clearance for "Hopper".
5. A privacy policy URL.

## Current limitations

- The native Silo contracts have only been exercised against two servers, not validated across server versions.
- Playback behavior has not yet been qualified across old and current LG webOS models.
- Token refresh is implemented (`POST /api/v2/auth/refresh`, single-flight per session). Expired-session and network-loss recovery UX still need work.
- The audiobook player still shares the video player: no multi-part timeline, chapters, bookmarks, sleep timer or speed control.
- Episode long-press actions, detail translation controls and invite-code sign-up are not implemented.
- Audio delay is 0 to 1000 ms only. WebAudio cannot advance audio.
- Automated tests for navigation, auth, parsing, and player state are not yet present.
- Accessibility review and LG certification remain outstanding.
- `--accent` is not defined, so the progress ring falls back to `#2f6bff` instead of brand teal.

## Contributing

Issues and focused pull requests are welcome. Before proposing API changes, validate them against Silo's current native server contract or official clients; do not infer endpoints from Jellyfin compatibility behavior.

For changes:

1. Keep the architecture boundaries described above.
2. Ensure all interactive controls remain reachable with Up, Down, Left, Right, OK, and Back.
3. Run `npm run build` before opening a pull request.
4. Describe whether the change was tested in a browser, against a live Silo server, and on physical LG hardware.

## License and trademarks

No license has been granted for this repository yet. Unless and until a license file is added, normal copyright restrictions apply to the code in this repository.

The Silo name and logo are separately trademarked. Development and private sideloading may use working branding, but public distribution or LG Content Store publication requires permission from the trademark owner.
