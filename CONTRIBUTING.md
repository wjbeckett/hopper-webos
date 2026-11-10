# Contributing to Hopper

Thanks for helping. This guide covers setting up a development environment, running Hopper in a browser, deploying it to an LG TV, and the conventions a pull request should follow.

## Requirements

- Node.js and npm.
- A Silo server you can reach from your computer.
- To run on a TV:
  - An LG webOS TV with the **Developer Mode** app installed.
  - An LG developer account.
  - LG's [`@webos-tools/cli`](https://www.npmjs.com/package/@webos-tools/cli), installed with `npm install -g @webos-tools/cli`.
  - Your computer and the TV on the same network.

On Arch-based Linux, `scripts/setup-cachyos.sh` installs the system packages, the webOS CLI and the project dependencies.

## Run in a browser

```bash
npm install
SILO_DEV_SERVER=https://silo.example.com npm run dev
```

Open the URL Vite prints.

- **Keys:** arrows move focus, Enter selects, and Escape or Backspace act as Back.
- **API proxy:** the dev server forwards `/__silo` (including websockets) to `SILO_DEV_SERVER`, so browser requests stay same-origin. Self-signed certificates are accepted.
- **Phone pairing** needs the TV's background service, so it only works on a TV. In a browser, use **Enter server address**.

## Connect an LG TV

On the TV:

1. Install **Developer Mode** from the LG Content Store and sign in with your LG developer account.
2. Turn on **Dev Mode Status** and **Key Server**.
3. Note the TV's IP address and the passphrase shown in the app.

On your computer:

```bash
ares-setup-device                          # add the TV, e.g. as "livingroom"
ares-novacom --device livingroom --getkey  # fetch the developer key
ares-device-info --device livingroom       # check the connection
```

Developer Mode sessions expire. If deploys stop working, open the Developer Mode app, extend the session, and fetch the key again if needed.

## Build and deploy

```bash
npm run build                                  # type-check and build to dist/
WEBOS_DEVICE=livingroom npm run webos:deploy   # build, package, install and launch
WEBOS_DEVICE=livingroom npm run webos:inspect  # open LG Web Inspector for the app
```

`WEBOS_DEVICE` defaults to `livingroom`. The app ID is `com.hopperapp.hopper`; set `WEBOS_APP_ID` if you change `public/appinfo.json`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on all interfaces |
| `npm run build` | Type-check and production build in `dist/` |
| `npm run preview` | Preview the production build |
| `npm run webos:check` | Check Node, npm, the LG CLI and configured devices |
| `npm run webos:package` | Build and package an IPK (app plus pairing service) into `release/` |
| `npm run webos:install` | Install the IPK on the TV |
| `npm run webos:launch` | Launch the app on the TV |
| `npm run webos:deploy` | Package, install and launch |
| `npm run webos:inspect` | Open Web Inspector for the app |

## Project conventions

- **Native Silo API only.** Don't use Jellyfin-compatible endpoints, headers, models or playback URLs, and don't guess endpoints. Check them against Silo's server contract or the official clients.
- **The official Android TV client is the reference** for layout, behaviour and focus flow. If you change a screen, check how Android TV handles it first. Hopper is its own client and differs in places on purpose; those are listed under "Where Hopper differs" in [`docs/DECISIONS.md`](docs/DECISIONS.md).
- **Remote first.** Every control must be reachable with Up, Down, Left, Right, OK and Back. One OK press must trigger exactly one action.
- **Code layout:**
  - API access goes in `src/api`. UI components don't contain raw API URLs.
  - LG/webOS-specific code goes in `src/platform`.
  - Focus and remote handling go in `src/navigation`.
  - The phone-pairing service in `services/pairing` runs on the TV's Node 12. Write it in ES5-style JavaScript: no optional chaining and no `??`.
- **Older TVs:** webOS 22 runs Chrome 87. CSS `:has()` doesn't exist there, and SVG transforms need `transform-box: fill-box`.
- **Diagnostics stay on the device.** Don't add code that uploads logs or reports.

## Pull requests

All changes reach `main` through a pull request from their own branch. By opening one, you agree that your contribution is licensed under `AGPL-3.0-or-later`, like the rest of the project (see [`LICENSE`](LICENSE)).

1. **Fork the repository** and create a branch from `main`: `git checkout -b fix/short-description origin/main`. (Maintainers branch in the main repository.)
2. **Keep changes focused.** One feature or fix per pull request.
3. **Run `npm run build`.** It must pass, because there is no separate lint or test step yet.
4. **Open the pull request into `main`** and fill in the template. Say how you tested the change: browser, live Silo server, or physical LG TV (with the model or webOS version).
5. **Leave "Allow edits by maintainers" ticked** so small fixes can be pushed to your branch.
6. Don't include personal server URLs, tokens or screenshots of private libraries.

### What happens after you open it

- **Build** type-checks and builds your branch. On your first pull request a maintainer may need to approve the run.
- **Labels** for size and area are added automatically.
- **Automated review:** Claude reviews the change against the conventions above and posts a summary of what it checked, plus inline suggestions you can apply from the **Files changed** tab. On your first pull request a maintainer starts it; after that it runs on every push. It reads your diff but never builds or runs your code.
- **TV testing:** a maintainer tests the change on LG hardware before merging, so clear steps in the "Needs checking on a TV" section speed things up.

The review is a first pass, not the final word. If you think a suggestion is wrong, say so in the thread.

Maintainers: the full process is in [`docs/MAINTAINING.md`](docs/MAINTAINING.md).

## Brand assets

To change the icon, splash or store artwork, see [`brand/README.md`](brand/README.md).

The Hopper name and artwork are not under the AGPL. Contributions to the artwork are welcome. A fork you distribute needs its own name, artwork and app ID; see [`TRADEMARK.md`](TRADEMARK.md).
