# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Start every session with `docs/HANDOFF.md`.** It records the current state of the project, open items and next steps, and it is the starting point for the next round of changes. Update it at the end of each piece of work.

## What this is
Hopper (`com.hopperapp.hopper`) is an LG webOS TV client for the Silo media server. The goal is a first-class TV client whose features match the official Android TV and Apple tvOS clients. It is built with React 19, TypeScript and Vite and packaged with LG `@webos-tools/cli`. It is a 10-foot UI: every interactive element must be reachable with Up/Down/Left/Right/OK/Back, and mouse/pointer support is secondary.

## Hard rules
1. **No bulk overwrites.** Never do bulk checkouts, resets, restores, regenerations or whole-tree copies over `src/`. Make targeted edits to specific files, and rewrite a whole file only when that single file needs it. Commit to your working branch and push it after each verified step so work never lives only in the working tree (see Development procedure).
2. **Android TV is the reference.** The Android TV app in `silo-android/androidTvApp/` sets the design and behaviour for every screen, menu, focus/back flow and server action. That directory is git-ignored and may need a local checkout. Read the relevant Android source before building or changing anything, and match it as closely as webOS allows. Deviate only where the user has explicitly decided to (see `docs/FIRST_GRADE_ROADMAP.md` and `docs/RECONSTRUCTION.md`). Rebuild Android transitions with webOS-safe CSS and DOM behaviour; don't assume Compose behaviour carries over.
3. **Native Silo API only.** Never use Jellyfin-compatible endpoints, headers, models or playback URLs. Mirror Android's documented native Silo contracts rather than inventing routes.
4. **Diagnostics stay local.** The Silo maintainer won't accept reports from third-party clients. Never integrate with the hosted diagnostics collector, and never imply that the app collects or uploads reports.
5. **Don't overclaim parity.** Before claiming parity, compare every exposed destination and workflow against Android TV, and name anything unimplemented or not verified against a server.
6. **Update Documentation.** After every run, update relevant documentation with recent changes or closed off items (Parity TODO, Readme, etc)

## Commands
```bash
npm install
SILO_DEV_SERVER=https://silo.example.com npm run dev   # Vite on 0.0.0.0; proxies /__silo -> SILO_DEV_SERVER (ws too, self-signed OK)
npm run build                                          # tsc -b + vite build -> dist/  (the only verification gate)
WEBOS_DEVICE=livingroom npm run webos:deploy           # build, package IPK (app + services/pairing), install, launch
WEBOS_DEVICE=livingroom npm run webos:inspect          # LG Web Inspector
npm run webos:check                                    # verify node/ares tooling and devices
```
- There is no linter and no test suite yet. `npm run build`, which type-checks, is the check to run before committing.
- `WEBOS_APP_ID` overrides the app ID for launch and inspect.
- In the browser, arrow keys move focus, Enter selects, and Escape or Backspace act as Back.
- During `vite dev`, `POST /__client-log` echoes client logs to the terminal.

## Development procedure
Every change follows the same path, whatever its size: code, docs, brand assets and workflow files alike.

```
new branch off main  ──pull request──►  main
```

`main` is the only long-lived branch. There is no `dev` branch.

1. **Branch off the latest `main`.** `git fetch origin main && git checkout -b <type>/<slug> origin/main`. Use `fix/<issue-number>-<slug>` for a GitHub issue, otherwise `feat/`, `chore/` or `docs/` plus a short slug. One feature or fix per branch.
2. **Work on the branch.** Never commit directly to `main`. Run `npm run build`, then commit and push the branch after each verified step.
3. **Open a pull request into `main`.** The maintainer opens and merges it; draft the title and body for them (following `.github/pull_request_template.md`) unless they ask you to open it. Say how the change was tested: build, browser, live server or physical TV.
4. **Automation runs on the PR.** `ci.yml` builds it and `pr-intake.yml` labels it. `claude-review.yml` reviews every non-draft PR from a branch in this repository and may push small `review: ` fix commits to the branch, so pull before adding commits. PRs from forks get a read-only review from `pr-intake.yml` instead.
5. **The maintainer tests on a physical TV before merging** whenever the change affects the app. A release is a tag on a tested `main` commit.

- **Issue fixes** use the `fix-issue` skill (`.claude/skills/fix-issue/SKILL.md`), which follows this procedure: triage, investigate, fix on a branch off `main`, then draft the PR.
- **Maintainer steps, what is automatic and what is manual, labels and settings** are in `docs/MAINTAINING.md`. Keep it in step with the workflows in `.github/workflows/`.
- **Fork PRs are untrusted.** `pr-intake.yml` runs with secrets on `pull_request_target`, so it must never check out, install or run pull request code, and Claude there must stay limited to reading files. Don't loosen that without the maintainer's say-so.
- **A PR that changes `claude-review.yml` is not reviewed by it.** The Claude action skips the review (the check still goes green, with no comment) unless the file in the PR matches the copy on `main`. That is expected; reviews resume once the change is merged.

## Architecture
Keep each concern in its own layer:
- Silo API access goes in `src/api`, with no raw API URLs in UI components.
- LG/webOS-specific behaviour goes in `src/platform`.
- Remote and focus behaviour goes in `src/navigation`.

### App shell and API
- **`src/App.tsx` is the router and state root.** There is no router library. Auth routes (`AuthRoute`), top-level sections (`AppSection` from `TopNav`) and a `DetailRoute` union cover details, series, person, play-choice and player. The last route is saved to `localStorage` (`silo-webos-navigation-v1`). `safeBrowsingRoute` never restores straight into the player. App.tsx also applies profile theme tokens (`THEME_TOKENS`), installs spatial navigation, connects the realtime events socket and controls the startup splash.
- **`src/api/`:**
  - `silo.ts` is the main client. `requestV2`/`v2Url` build `/api/v2/...` calls from a `Session`. `refreshSession` performs single-flight token refresh per session.
  - `deviceLogin.ts` handles QR/device sign-in. The token fields come back only on the first approved poll.
  - `playback.ts` and `playbackConnection.ts` handle protocol-v3 playback planning and replanning, plus the cached watch detail.
  - `events.ts` is the realtime socket (`user_state`/`catalog` events).
  - `settings.ts` resolves effective server and profile settings.
  - `subtitles.ts` and `diagnostics.ts` cover their own areas.
- **Playback** should direct play when the TV supports it, but it must always be negotiated through Silo PlaybackInfo/device profiles. Treat `directVideoUrl()` as temporary scaffolding.

### Navigation
- **`src/navigation/spatial.ts`** is one global keydown handler. It covers D-pad movement, the top nav, library grids, rails (`RAIL_SELECTOR` pins the focused card), modals (`[data-modal="true"]`) and Back.
  - Focusable elements are marked `data-tv-focusable="true"`, with `data-nav-primary` for the preferred target.
  - The handler steps aside entirely while `.player-shell` exists. `PlayerScreen` owns its own key map, mirroring Android's player.
  - Screens use `focusFirstContentCard`, `attemptFirstContentFocus` and `focusTopNavigation` for focus on entry.

### Platform and pairing
- **`src/platform/`:**
  - `capabilities.ts` probes codecs via `canPlayType`. Progressive and original-file delivery are disabled, so playback is HLS.
  - `pairing.ts` makes Luna calls to the bundled service.
  - `audioDelay.ts` stays at 0..1000 ms (Android allows -1000..1000) unless a webOS-safe way to advance audio is demonstrated, because a WebAudio `DelayNode` can't advance audio.
  - The other modules are `captions`, `dolbyVision`, `device` and `youtube`.
- **`services/pairing/`** is a Node 12 webOS JS service (`com.hopperapp.hopper.service`). It advertises `_silopair-roku._tcp` over mDNS and relays phone pairing frames. `scripts/package-webos.sh` packages it into the same IPK. Write it in ES5-ish style: no optional chaining and no `??`. Browser mDNS doesn't exist, so keep manual and saved-server management in place.

### State, screens and styling
- **`src/core/`** holds client-side state that isn't API or UI:
  - `serverRegistry.ts` stores saved servers and sessions in `localStorage`.
  - `watchState.ts` is a pub/sub. `publishWatchState` updates cards and rails in place, and `publishRailsChanged` triggers refetches.
  - The other modules cover artwork and title art, theme music, profile launch/PIN gating, subtitle styling and sync, browse prefs and episode navigation.
- **`src/screens/`** holds full screens. `PlayerScreen.tsx` is the largest and owns all playback UI. Audiobooks currently share it. **`src/components/`** holds the shared 10-foot UI (`TopNav`, `MediaCard`, `FeaturedRailsScreen` for Home and library rails, `PlaybackOptions`, `HopperMark`).
- **Styling:** everything is in `src/styles.css`. `main.tsx` adds the `webos` class on TVs to turn on lighter paint rules. Theme values are CSS custom properties set from `THEME_TOKENS`.

## TV navigation and browsing rules
- **Focus across transitions:** keep focus on the intended control when the screen changes, and request initial content focus only after focusable content exists.
- **One activation per press:** handle OK/Enter once per remote press. When activation changes screens, consume the matching key-up so the same press can't activate the newly focused control.
- **Stable paging:** keep item keys stable and append cursor pages in the order the API returns them. Never re-sort already-rendered results when a later page arrives; keeping focus and scroll position matters more.
- **Load at the edge:** when focus reaches the loaded edge of a paged grid, load the next page without moving the current selection until a destination card exists.
- **Android as the guide:** follow Android TV's grid focus restoration and pagination, implemented natively in React for webOS.

## webOS runtime gotchas (verified on Chrome 87 TVs)
- No CSS `:has()`.
- CSS transforms on SVG elements need `transform-box: fill-box`.
- Video renders on a hardware layer, so inspector screenshots show a blank player.

## Branding
- The working name is **Hopper**. The Silo name and logo are trademarked separately from the AGPL code, and Silo logo assets have been removed from the app. Public store publishing needs permission; the submission status is in `brand/store/LISTING.md`.
- Brand sources and the render pipeline are in `brand/` (see `brand/README.md`). Keep `src/components/HopperMark.tsx` geometry in sync with `brand/hopper-icon.svg`.
- Render with `brand/render.sh` (headless Chrome). Don't use Quick Look, which distorts non-square SVGs.

## After each verified step
1. Run `npm run build`.
2. Commit to the working branch and push it (never directly to `main`).
3. Update `docs/FIRST_GRADE_ROADMAP.md` (status and change log, newest at the bottom) and `docs/ANDROID_PARITY_TODO.md`, saying how each item was verified: build, browser or physical TV.
4. Refresh `docs/HANDOFF.md` so the next session starts from the current state.
5. If a user-visible feature shipped or a limitation was removed, update the Features or Known limitations section of `README.md`. The README is public and user-facing: keep build and setup material in `CONTRIBUTING.md`, brand material in `brand/README.md`, and personal device or server details out of both. Update the README Availability table whenever a store submission or release happens.

## Local notes
- Never commit personal server URLs, tokens or `localStorage` backups. Any change to a TV's `localStorage` must back it up first and keep `silo-webos-device-id`.
- Shell heredocs have hung the agent tool runner before. Prefer file edits or `sed`/`perl`.
