# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Start every session with `docs/HANDOFF.md`.** It records the current state of the project, open items and next steps, and it is the starting point for the next round of changes. Update it at the end of each piece of work.

## What this is
Hopper (`com.hopperapp.hopper`) is an LG webOS TV client for the Silo media server. The goal is a first-class TV client in its own right. It stays close to the official Android TV and Apple tvOS clients in features and behaviour, and may differ from them on purpose. It is built with React 19, TypeScript and Vite and packaged with LG `@webos-tools/cli`. It is a 10-foot UI: every interactive element must be reachable with Up/Down/Left/Right/OK/Back, and mouse/pointer support is secondary.

## Hard rules
1. **No bulk overwrites.** Never do bulk checkouts, resets, restores, regenerations or whole-tree copies over `src/`. Make targeted edits to specific files, and rewrite a whole file only when that single file needs it. Commit to your working branch and push it after each verified step so work never lives only in the working tree (see Development procedure).
2. **Android TV is the reference, not the definition.** Hopper is its own client. The official Android TV app in `silo-android/androidTvApp/` (git-ignored; it may need a local checkout) is the reference for behaviour, layout, focus/back flow and server contracts. Read the relevant Android source before building or changing a screen, menu or server action, and stay close to it unless there is a reason not to. Hopper may differ on purpose, for webOS limits or for its own design. The maintainer decides each difference; record it under "Where Hopper differs" in `docs/BACKLOG.md`, and never undo a recorded difference to match Android. Rebuild Android transitions with webOS-safe CSS and DOM behaviour; don't assume Compose behaviour carries over.
3. **Native Silo API only.** Never use Jellyfin-compatible endpoints, headers, models or playback URLs. Take endpoints and payloads from the Android client's native Silo contracts or the server's own API spec; never invent routes.
4. **Diagnostics stay local.** The Silo maintainer won't accept reports from third-party clients. Never integrate with the hosted diagnostics collector, and never imply that the app collects or uploads reports.
5. **Don't claim more than was verified.** Say how far each thing was checked: source, build, browser, live server or physical TV. Built is not working on a TV. Don't describe a feature as matching the official clients unless it was compared against them, and name anything unimplemented or unverified.
6. **Update the docs in the same change.** Every run that changes the repository, whether a feature, a fix, a cleanup or a workflow change, also updates every doc it makes out of date, in the same branch and pull request. Use the table under "Docs to keep current". A change is not finished, and its PR is not ready, until that is done.

## Commands
```bash
npm install
SILO_DEV_SERVER=https://silo.example.com npm run dev   # Vite on 0.0.0.0; proxies /__silo -> SILO_DEV_SERVER (ws too, self-signed OK)
npm run build                                          # tsc -b + vite build -> dist/  (the only verification gate)
WEBOS_DEVICE=livingroom npm run webos:deploy           # build, package IPK (app + services/pairing), install, launch
WEBOS_DEVICE=livingroom npm run webos:inspect          # LG Web Inspector
npm run webos:check                                    # verify node/ares tooling and devices
```
- There is no linter and no test suite yet. `npm run build`, which type-checks, is the check to run before committing. It fails on unused locals, imports and parameters (`noUnusedLocals`, `noUnusedParameters`); prefix a parameter you must keep with `_`.
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
3. **Open a pull request into `main` for every change.** Once the work is verified and pushed, open the PR yourself with `gh pr create --base main` (ready for review, not a draft, so the build and the automated review run). Do not stop at a pushed branch or a drafted description. Follow `.github/pull_request_template.md` and say how the change was tested: build, browser, live server or physical TV. Several unrelated changes in one session get one branch and one PR each. The maintainer tests and merges.
4. **Automation runs on the PR.** `ci.yml` builds it and `pr-intake.yml` labels it. `claude-review.yml` reviews every non-draft PR from a branch in this repository and may push small `review: ` fix commits to the branch, so pull before adding commits. PRs from forks get a read-only review from `pr-intake.yml` instead.
5. **The maintainer tests on a physical TV before merging** whenever the change affects the app. A release is a tag on a tested `main` commit.

- **Issue fixes** use the `fix-issue` skill (`.claude/skills/fix-issue/SKILL.md`), which follows this procedure: triage, investigate, fix on a branch off `main`, then open the PR.
- **No AI attribution anywhere.** Do not add `Co-Authored-By` trailers or "Generated with" lines to commit messages, pull request descriptions, comments or reviews.
- **Writing for people goes through the `unslop` skill** (`.claude/skills/unslop/SKILL.md`): PR titles and descriptions, issue and PR comments, and review comments and summaries. Write the text, then apply the skill as a final pass before posting. It does not apply to code, commands, logs or quoted text.
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
- **Playback** should direct play when the TV supports it, but it must always be negotiated through Silo PlaybackInfo/device profiles.

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
- **Android as the starting point:** grid focus restoration and pagination follow Android TV's behaviour, implemented natively in React for webOS.

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
2. Update the docs the step affects (table below).
3. Commit to the working branch and push it (never directly to `main`).
4. When the change is complete, open the pull request (see Development procedure). Its "Docs updated" section lists the docs you changed, or says "None needed" and why.

## Docs to keep current
There is no change log file. The history is the merged pull requests, so each PR description must say what changed and how it was tested.

| Doc | Holds | Update it when |
| --- | --- | --- |
| `docs/HANDOFF.md` | Current state, release blockers, open items, working notes | Every change. Move finished items out, add new open items, and correct anything the change made untrue. Say how each thing was verified: build, browser, live server or physical TV |
| `docs/BACKLOG.md` | Open work, deliberate differences from Android TV, what is not planned, and verification status of shipped features | An item is finished, narrowed or found, a difference from Android is decided, or a feature's verification level changes |
| `README.md` | What users get: Features, Known limitations, Availability | A user-visible feature ships, a limitation is removed or added, or a store submission or release happens |
| `CONTRIBUTING.md` | Setup, browser development, TV deploy, PR conventions | Commands, tooling, scripts or contribution rules change |
| `docs/MAINTAINING.md` | What the PR automation does and the maintainer's steps | A workflow in `.github/workflows/`, a label or a repository setting changes |
| `CLAUDE.md` | Rules, commands, architecture and procedure for agents | Architecture, commands, rules or this table change |
| `brand/README.md`, `brand/store/LISTING.md` | Brand sources, render pipeline, store listing and submission checklist | Artwork, the render pipeline or the listing changes |
| `.claude/skills/*/SKILL.md` | Agent skills | The procedure a skill describes changes |

The README is public and user-facing: keep build and setup material in `CONTRIBUTING.md`, brand material in `brand/README.md`, and personal device or server details out of both.

## Local notes
- Never commit personal server URLs, tokens or `localStorage` backups. Any change to a TV's `localStorage` must back it up first and keep `silo-webos-device-id`.
- Shell heredocs have hung the agent tool runner before. Prefer file edits or `sed`/`perl`.
