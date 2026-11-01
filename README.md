# Silo for LG webOS

An early, community-built LG webOS TV client for the [Silo](https://silo.tv/) self-hosted media server. It is designed as a 10-foot interface: every primary action is usable with a TV remote, while mouse and keyboard support make browser development convenient.

> [!IMPORTANT]
> This project is under active development and is not store-ready. Native Silo authentication, catalog, and playback contracts still need validation against a live server, and playback needs testing across multiple LG webOS generations.

## Highlights

- Native Silo device/QR sign-in, with username and password as a fallback
- Multiple saved Silo servers and locally persisted sessions
- Profile-aware home layout, libraries, favorites, and watchlist
- Focused-item home artwork backdrop with TV-safe crossfades
- Movies, TV, music, and audiobook library surfaces
- Library Browse with catalog-backed sorting, facets, server-side A–Z prefix, remembered sort/filters, and TV-remote-friendly filter panels
- Per-library Collections (grouped, with collection detail), audiobook Authors/Series, A–Z, empty-library states, and server-backed Shuffle for libraries and collections
- Series, season, and episode navigation
- Calendar releases, collections, watch history, and request workflows
- Household profile switching with PIN verification
- Continue Watching and other server-defined home rails, refreshed live from the server's realtime events socket (user_state/catalog), with a polling fallback
- Watch state (watched, favorite, watchlist, resume position) updates cards and rails in place without refetching
- Debounced catalog search
- D-pad spatial navigation and LG Back-key handling
- Protocol-v3 playback planning and replanning
- HLS playback with negotiated request headers
- Resume, seek, chapter markers, and playback progress reporting
- Audio track, subtitle track, file version, and quality selection
- Profile appearance themes and text preferences
- Android TV-style Settings for General, Playback, Subtitles, local Diagnostics log viewing/ZIP export, and Server; diagnostic logs remain on-device and are never uploaded to Silo
- Build, package, install, launch, and inspect helpers for LG TVs

## Project status

The current development version is `0.2.0-dev`.

The main workflows are implemented and compile successfully, but the application has not yet reached a stable release. In particular, the native Silo API payloads and playback routes must be exercised against a live Silo installation, and codec/container support must be verified on physical LG hardware.

See [the first-grade client roadmap](docs/FIRST_GRADE_ROADMAP.md) for the release blockers and longer-term parity targets.

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

`WEBOS_DEVICE` defaults to `livingroom`. The application ID defaults to `org.siloserver.webos`; override it for launch and inspection with `WEBOS_APP_ID` if you change `public/appinfo.json`.

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
public/                  webOS metadata and application icons
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

## Current limitations

- The native Silo contracts have not yet been validated end-to-end against the target live server.
- Playback behavior has not yet been qualified across old and current LG webOS models.
- Token refresh and single-flight retry are not implemented.
- Household profile selection and PIN entry are not implemented.
- Network-loss recovery and expired-session UX need work.
- Subtitle styling and quick-subtitle pickers are incomplete; trickplay previews, intro/credits skip pills, and the rebuilt player chrome need device qualification.
- Automated tests for navigation, auth, parsing, and player state are not yet present.
- Store assets, accessibility review, privacy copy, trademark permission, and LG certification remain outstanding.

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
