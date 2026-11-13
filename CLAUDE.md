# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Start every session with the open issues.** The work list is GitHub issues, grouped by milestone (see "What to work on"). There is no handoff or backlog file. Read `docs/DECISIONS.md` before changing behaviour: it lists what Hopper does differently on purpose.

## What this is
Hopper (`com.hopperapp.hopper`) is an LG webOS TV client for the Silo media server. The goal is a first-class TV client in its own right. It stays close to the official Android TV and Apple tvOS clients in features and behaviour, and may differ from them on purpose. It is built with React 19, TypeScript and Vite and packaged with LG `@webos-tools/cli`. It is a 10-foot UI: every interactive element must be reachable with Up/Down/Left/Right/OK/Back. The Magic Remote pointer must work too (an LG requirement): it drives focus, so a control that the D-pad can reach works with the pointer without extra code.

## Hard rules
1. **No bulk overwrites.** Never do bulk checkouts, resets, restores, regenerations or whole-tree copies over `src/`. Make targeted edits to specific files, and rewrite a whole file only when that single file needs it. Commit to your working branch and push it after each verified step so work never lives only in the working tree (see Development procedure).
2. **Android TV is the reference, not the definition.** Hopper is its own client. The official Android TV app in `silo-android/androidTvApp/` (git-ignored; it may need a local checkout) is the reference for behaviour, layout, focus/back flow and server contracts. Read the relevant Android source before building or changing a screen, menu or server action, and stay close to it unless there is a reason not to. Hopper may differ on purpose, for webOS limits or for its own design. The maintainer decides each difference; record it under "Where Hopper differs" in `docs/DECISIONS.md`, and never undo a recorded difference to match Android. Rebuild Android transitions with webOS-safe CSS and DOM behaviour; don't assume Compose behaviour carries over.
3. **Native Silo API only.** Never use Jellyfin-compatible endpoints, headers, models or playback URLs. Take endpoints and payloads from the Android client's native Silo contracts or the server's own API spec; never invent routes.
4. **Diagnostics stay local.** The Silo maintainer won't accept reports from third-party clients. Never integrate with the hosted diagnostics collector, and never imply that the app collects or uploads reports.
5. **Don't claim more than was verified.** Say how far each thing was checked: source, build, browser, live server or physical TV. Built is not working on a TV. Don't describe a feature as matching the official clients unless it was compared against them, and name anything unimplemented or unverified.
6. **Update the docs and the issues in the same change.** Every run that changes the repository, whether a feature, a fix, a cleanup or a workflow change, also updates every doc it makes out of date, in the same branch and pull request, and keeps the issues true (see "What to work on"). Use the table under "Docs to keep current". A change is not finished, and its PR is not ready, until that is done.

## What to work on
GitHub issues are the only list of work. Do not keep to-do lists in docs.

| Milestone | Holds |
| --- | --- |
| Public repo | What must happen before the repository is made public |
| Store submission | What must happen before Hopper is submitted to the LG Content Store, including features the maintainer wants in the first store release |
| After store release | Features and improvements that do not block the store |

Work the earliest milestone that has open issues, unless the maintainer names an issue. An issue with no milestone has not been triaged yet; ask before starting it.

```bash
gh api repos/wjbeckett/hopper-webos/milestones --jq '.[] | "\(.number) \(.title): \(.open_issues) open"'
gh api 'repos/wjbeckett/hopper-webos/issues?state=open&milestone=<number>&per_page=100' \
  --jq '.[] | select(.pull_request | not) | "#\(.number) \(.title) [\([.labels[].name] | join(", "))]"'
```

- **Working an issue** uses the `fix-issue` skill (`/fix-issue <number>`), for features and verification as well as bugs. The PR says `Fixes #<number>` so merging closes the issue.
- **Labels:** `maintainer` issues need a decision or action from the maintainer; don't attempt them. `needs: tv` and `needs: live server` issues can't be finished without that hardware or server: do what can be done, say exactly what is left, and leave the issue open. `verification` issues are checks of things already built.
- **Work you find but don't do** becomes a new issue, with area labels and no milestone, so the maintainer can place it. Don't leave it as a note in a doc or a code comment.
- **Partly done:** if a PR finishes only part of an issue, say `Part of #<number>` and comment on the issue with what is left.

## Commands
```bash
npm install
SILO_DEV_SERVER=https://silo.example.com npm run dev   # Vite on 0.0.0.0; proxies /__silo -> SILO_DEV_SERVER (ws too, self-signed OK)
npm run build                                          # tsc -b + vite build -> dist/
npm test                                               # unit tests (Vitest, jsdom): src/**/*.test.ts
WEBOS_DEVICE=livingroom npm run webos:deploy           # build, package IPK (app + services/pairing), install, launch
WEBOS_DEVICE=livingroom npm run webos:inspect          # LG Web Inspector
npm run webos:check                                    # verify node/ares tooling and devices
```
- There is no linter. `npm run build`, which type-checks, and `npm test` are the checks to run before committing; CI runs both. Tests sit next to the code as `*.test.ts` and cover logic only (API parsing, token refresh, navigation scoring, the Dolby splitter, resume and episode rules). Add one when you change that kind of logic. They do not replace a check on the TV. It fails on unused locals, imports and parameters (`noUnusedLocals`, `noUnusedParameters`); prefix a parameter you must keep with `_`.
- Every build gets its own version, `<major>.<minor>.<commit count>` (for example 0.3.215), from `vite.config.ts`. It is stamped into the packaged `appinfo.json`, shown under Settings → Server with the commit hash, and sent in playback requests. `package.json` holds only `<major>.<minor>`; bump it there for a release. Don't hand-edit version numbers anywhere else.
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
2. **Work on the branch.** Never commit directly to `main`. Run `npm run build` and `npm test`, then commit and push the branch after each verified step.
3. **Open a pull request into `main` for every change.** Once the work is verified and pushed, open the PR yourself with `gh pr create --base main` (ready for review, not a draft, so the build and the automated review run). Do not stop at a pushed branch or a drafted description. Follow `.github/pull_request_template.md` and say how the change was tested: build, browser, live server or physical TV. Several unrelated changes in one session get one branch and one PR each. The maintainer tests and merges.
4. **Automation runs on the PR.** `ci.yml` builds it and `pr-intake.yml` labels it. `claude-review.yml` reviews every non-draft PR from a branch in this repository and may push small `review: ` fix commits to the branch, so pull before adding commits. PRs from forks get a read-only review from `pr-intake.yml` instead.
5. **The maintainer tests on a physical TV before merging** whenever the change affects the app. A release is a tag on a tested `main` commit.

- **Issue fixes** use the `fix-issue` skill (`.claude/skills/fix-issue/SKILL.md`), which follows this procedure: triage, investigate, fix on a branch off `main`, then open the PR.
- **No AI attribution anywhere.** Do not add `Co-Authored-By` trailers or "Generated with" lines to commit messages, pull request descriptions, comments or reviews.
- **Writing for people goes through the `unslop` skill** (`.claude/skills/unslop/SKILL.md`): PR titles and descriptions, issue and PR comments, and review comments and summaries. Write the text, then apply the skill as a final pass before posting. It does not apply to code, commands, logs or quoted text.
- **Maintainer steps, what is automatic and what is manual, labels and settings** are in `docs/MAINTAINING.md`. Keep it in step with the workflows in `.github/workflows/`.
- **Fork PRs are untrusted.** `pr-intake.yml` runs with secrets on `pull_request_target`, so it must never check out, install or run pull request code, and Claude there must stay limited to reading files. Don't loosen that without the maintainer's say-so.
- **A PR that changes `claude-review.yml` is not reviewed by it.** The Claude action skips the review unless the file in the PR matches the copy on `main`. The "Report review status" step then posts a status comment saying so. That is expected; reviews resume once the change is merged.

## Architecture
Keep each concern in its own layer:
- Silo API access goes in `src/api`, with no raw API URLs in UI components.
- LG/webOS-specific behaviour goes in `src/platform`.
- Remote and focus behaviour goes in `src/navigation`.

### App shell and API
- **`src/App.tsx` is the router and state root.** There is no router library. Auth routes (`AuthRoute`), top-level sections (`AppSection` from `TopNav`) and a `DetailRoute` union cover details, series, person and player. The last route is saved to `localStorage` (`silo-webos-navigation-v1`). `safeBrowsingRoute` never restores straight into the player. App.tsx also applies profile theme tokens (`THEME_TOKENS`), installs spatial navigation and connects the realtime events socket.
- **The startup splash is in `index.html`,** not in React: static markup and CSS that is on screen from the first paint, with each moving part as its own HTML element. `src/core/bootSplash.ts` lifts it once the animation has played. It plays on launches with a saved session only.
- **`src/api/`:**
  - `silo.ts` is the main client. `requestV2`/`v2Url` build `/api/v2/...` calls from a `Session`. `refreshSession` performs single-flight token refresh per session. A refresh the server refuses (400, 401, 403) ends the sign-in; any other failure keeps it.
  - `connection.ts` tracks whether the signed-in server answers. Requests go through its `serverFetch`, which turns "no answer" into a `NetworkError` and starts a check of the server. `App.tsx` listens to it for the connection-lost dialog (`components/ConnectionLost.tsx`), for loading screens again afterwards (screens are keyed on `connectionEpoch`), and for the signed-out return to sign-in. The player listens too and restarts the stream at the same position.
  - `deviceLogin.ts` handles QR/device sign-in. The token fields come back only on the first approved poll.
  - `playback.ts` and `playbackConnection.ts` handle protocol-v3 playback planning and replanning, plus the cached watch detail.
  - `events.ts` is the realtime socket (`user_state`/`catalog` events).
  - `settings.ts` resolves effective server and profile settings.
  - `subtitles.ts` and `diagnostics.ts` cover their own areas.
- **Leaving the app during playback:** the Home key hides the page, and the TV pauses the video and plays it again on return. `PlayerScreen.tsx` saves the position when the page is hidden, and starts the stream again if it was hidden for more than ten minutes. A hidden app may be closed by the TV without notice; `pagehide` stops the playback session.
- **Playback** should direct play when the TV supports it, but it must always be negotiated through Silo PlaybackInfo/device profiles. Never seek the video at start-up: a seek rebuilds the TV's media pipeline and costs seconds (`docs/PERFORMANCE.md`). A stream that fails for a reason other than the network is started again at the same position, once as it was and once with Dolby audio left out of the client's capabilities so Silo converts it (`recoverStream` in `PlayerScreen.tsx`, `allowDolbyAudio` in `src/api/playback.ts`).

### Navigation
- **`src/navigation/spatial.ts`** is one global keydown handler. It covers D-pad movement, the top nav, library grids, rails (`RAIL_SELECTOR` pins the focused card), modals (`[data-modal="true"]`) and Back.
  - Focusable elements are marked `data-tv-focusable="true"`, with `data-nav-primary` for the preferred target.
  - The handler steps aside entirely while `.player-shell` exists. `PlayerScreen` owns its own key map, mirroring Android's player.
  - Screens use `focusFirstContentCard`, `attemptFirstContentFocus` and `focusTopNavigation` for focus on entry.
- **`src/navigation/pointer.ts`** is the Magic Remote pointer. Pointing at a control focuses it, which is its selection effect; text fields are the exception (focus opens the TV's keyboard) and get a hover style.
  - While the pointer is over a row of cards (`RAIL_SELECTOR`), arrows at the row's edges page it by focusing a card further along.
  - `focusFromPointer()` is true while the pointer is moving focus. Code that brings the focused item into view must skip that then, or the page moves under the pointer.
  - New controls need `data-tv-focusable="true"` (or to be a button in the player) and a visible focus style. No `:hover` styles for them.

### Platform and pairing
- **`src/platform/`:**
  - `capabilities.ts` probes codecs via `canPlayType`, and audio codecs also alongside video in one MediaSource buffer, because that is how the HLS segments carry them.
  - `splitSourceBuffer.ts` and `fmp4Split.ts` make Dolby audio work: webOS 22 refuses AC-3 and E-AC-3 in a buffer shared with video, so the shared buffer hls.js asks for is replaced by a stand-in that splits each segment into a video buffer and an audio buffer. The audio is copied, never converted.
  - `startGap.ts` keeps hls.js from seeking over a small gap at the start of a stream (Dolby streams have one); the TV starts across it by itself.
  - `pairing.ts` makes Luna calls to the bundled service.
  - `back.ts` hands Back over to the TV (`PalmSystem.platformBack()`: the exit popup on webOS 6 and later, the Home launcher before that). It does nothing in a desktop browser.
  - `audioDelay.ts` stays at 0..1000 ms (Android allows -1000..1000) unless a webOS-safe way to advance audio is demonstrated, because a WebAudio `DelayNode` can't advance audio.
  - `keyboard.ts` tracks whether the TV's on-screen keyboard is showing (`keyboardStateChange`), so Back can leave it to the keyboard.
  - `displayHdr.ts` asks the TV's config service (`tv.model.supportHDR`) whether the screen shows HDR, because Chrome 87 has no `dynamic-range` media query. Without it Silo converts every HDR title to SDR.
  - The other modules are `captions`, `dolbyVision`, `device` and `youtube`.
- **`services/pairing/`** is a Node 12 webOS JS service (`com.hopperapp.hopper.service`). It advertises `_silopair-roku._tcp` over mDNS and relays phone pairing frames. `scripts/package-webos.sh` packages it into the same IPK. Write it in ES5-ish style: no optional chaining and no `??`. Browser mDNS doesn't exist, so keep manual and saved-server management in place.

### State, screens and styling
- **`src/core/`** holds client-side state that isn't API or UI:
  - `serverRegistry.ts` stores saved servers and sessions in `localStorage`, without their tokens.
  - `secureStore.ts` holds the tokens. The refresh and profile tokens are encrypted with AES-GCM under a non-extractable WebCrypto key kept in IndexedDB (`hopper-keys`), and stored in `silo-webos-sealed-v1`. The access token is never stored: `ensureAccessToken` in `src/api/silo.ts` renews it before the first request after a launch. `main.tsx` waits for `loadSecrets` (and the one-time migration of plain sessions) before rendering. Where WebCrypto or IndexedDB is missing (an insecure page), or an encrypted write fails, tokens stay in plain storage as before; a failed write is retried and the plain copy removed once it succeeds. A refresh that returns after the sign-in was cleared or replaced is discarded, never saved.
  - `watchState.ts` is a pub/sub. `publishWatchState` updates cards and rails in place, and `publishRailsChanged` triggers refetches.
  - The other modules cover artwork and title art, theme music, profile launch/PIN gating, subtitle styling and sync, browse prefs and episode navigation.
- **Home, For You and library Recommended** are `FeaturedRailsScreen`. It is built for a slow TV, so keep these properties when changing it (measurements and reasons in `docs/PERFORMANCE.md`):
  - Only rows near focus render cards, and each `MediaRail` renders the cards around the focused one. Other positions are empty `.media-card-wrap` placeholders.
  - Nothing scrolls. `slideRailItem` in `spatial.ts` and `keepFocusedRailInView` move a row's `.rail-strip` and the band's `.home-rails-inner` with a CSS-animated `transform`.
  - The hero is `HomeHero`, driven through a ref, so a focus change does not re-render the rows. On a TV its backdrop is two persistent images (`TvBackdrop`).
  - Home's rows are cached in `src/core/homeRailsCache.ts`, so Back shows Home at once and focus returns to the same card.
- **Every horizontal row slides the same way:** a container with `data-slide="true"` whose first child is a `.rail-strip` holding the cards. `MediaRail` does it with `slide`; the episode row, cast and trailer rows and the player's On Deck row have the markup directly. The focused card is centred and the ends clamp. Use `placeRailItem` to put a card in place without animating, and `resetSlidingRail` to go back to the start. A new row should do the same, not scroll.
- **Details and Series heroes keep their height.** The overview is `components/ExpandableOverview.tsx`: three lines, a focus stop above the buttons, and OK opens the whole text in a popup (Android's `TvExpandableSynopsis`). On Series every hero line has a fixed height, so the season tabs and episode row never move as focus changes episode. A row that fits on screen with the page at its top keeps the page there (`keepInViewVertically`).
- **Grids** (`.library-grid`) are scrolled by `keepInViewVertically` in `spatial.ts`: an eased slide for one press and a jump while a key is held. On a TV, `src/navigation/gridWindow.ts` hides cards more than six rows from focus (`.grid-far`).
- **`src/screens/`** holds full screens. `PlayerScreen.tsx` is the largest and owns all playback UI. Audiobooks currently share it. **`src/components/`** holds the shared 10-foot UI (`TopNav`, `MediaCard`, `FeaturedRailsScreen` for Home and library rails, `PlaybackOptions`, `HopperMark`).
- **Styling:** everything is in `src/styles.css`. `main.tsx` adds the `webos` class on TVs to turn on lighter paint rules. Theme values are CSS custom properties set from `THEME_TOKENS`.
- **Text size floor:** at the default text size, nothing a viewer reads is under 20 px (LG's recommendation for 1920x1080). Overviews (Home hero, Details, Series, Person) are 24 px. `body` is 1.25rem, so text without a size of its own starts at 20 px, and `<small>` never drops below it. Give new sizes in rem (1.25rem = 20 px) so the profile's text-size setting (`html[data-text-scale]`, from the server's appearance settings) still scales them. Write weights as `calc(<weight> + var(--font-weight-boost))` (or the `--font-weight-*-ui` variables) so the Bold text setting (`html[data-text-weight="strong"]`) reaches them. The player is the exception: its text sizes are in px on Android's scale and its weights are fixed, so neither setting changes it. Only icon glyphs (the ✓ check on cards, the numbers inside the skip icons, the ✎ edit badge) stay smaller.

## TV navigation and browsing rules
- **Focus across transitions:** keep focus on the intended control when the screen changes, and request initial content focus only after focusable content exists.
- **One activation per press:** handle OK/Enter once per remote press. When activation changes screens, consume the matching key-up so the same press can't activate the newly focused control.
- **Back on an entry page leaves the app** (LG requirement). The app's Back handler (`onBack` in `App.tsx`) calls `platformBack()` from `src/platform/back.ts` on Home with focus on the Home tab, on the full-screen profile picker, and on the sign-in screen shown first. On a TV that is phone setup whenever nobody is signed in, with or without a saved server (`signedOutEntry` in `App.tsx`); where there is no pairing service it is device sign-in, and first-run setup or server setup can also be first. Anywhere deeper, Back goes one step back: device sign-in returns to phone setup, and password sign-in returns to device sign-in. On password sign-in and first-run setup, Back does nothing while the TV's keyboard is open (`src/platform/keyboard.ts`), because the keyboard takes it. A new screen that can be the first thing shown needs the same treatment.
- **Stable paging:** keep item keys stable and append cursor pages in the order the API returns them. Never re-sort already-rendered results when a later page arrives; keeping focus and scroll position matters more.
- **Load at the edge:** when focus reaches the loaded edge of a paged grid, load the next page without moving the current selection until a destination card exists.
- **Android as the starting point:** grid focus restoration and pagination follow Android TV's behaviour, implemented natively in React for webOS.

## webOS runtime gotchas (verified on Chrome 87 TVs)
- No CSS `:has()`.
- CSS transforms on SVG elements need `transform-box: fill-box`.
- Video renders on a hardware layer, so inspector screenshots show a blank player.
- `window.devicePixelRatio` reports 2 but the page renders at 1920x1080. Don't size images or canvases from it.
- A transition or animation on an element makes it a compositor layer for as long as it runs. Inside lists that means layers made and dropped on every focus change, which costs more than it draws.
- Animations of shapes inside one `<svg>` are painted on the main thread, so they drop frames whenever the app is busy (launch, page loads). For anything that must stay smooth, animate separate HTML elements with `transform` and `opacity` only; the compositor runs those without the main thread.

## Branding
- The working name is **Hopper**. The Silo name and logo are trademarked separately from the AGPL code, and Silo logo assets have been removed from the app. Public store publishing needs permission; the submission status is in `brand/store/LISTING.md`.
- The Hopper name and artwork are reserved outside the AGPL by `TRADEMARK.md` and `brand/NOTICE` (unregistered ™, no ®). New brand files belong in `brand/`; if artwork goes anywhere else, add it to the "Brand files" table in `TRADEMARK.md` and the list in `brand/NOTICE`.
- Brand sources and the render pipeline are in `brand/` (see `brand/README.md`). Keep `src/components/HopperMark.tsx` and the splash layers in `index.html` in sync with `brand/hopper-icon.svg`.
- Render with `brand/render.sh` (headless Chrome). Don't use Quick Look, which distorts non-square SVGs.

## After each verified step
1. Run `npm run build` and `npm test`.
2. Update the docs the step affects (table below).
3. Commit to the working branch and push it (never directly to `main`).
4. When the change is complete, open the pull request (see Development procedure). Its "Docs updated" section lists the docs you changed, or says "None needed" and why.

## Docs to keep current
There is no change log, handoff or backlog file. The history is the merged pull requests, so each PR description must say what changed and how it was tested. Open work is GitHub issues.

| Doc | Holds | Update it when |
| --- | --- | --- |
| GitHub issues | All open work, with milestones and labels | Every change: close what it finishes (`Fixes #n`), comment on what it narrows, open an issue for new work found |
| `docs/DECISIONS.md` | Deliberate differences from Android TV, and what is not planned | The maintainer decides a new difference, or decides not to build something |
| `README.md` | What users get: Features, Known limitations, Availability | A user-visible feature ships, a limitation is removed or added, or a store submission or release happens |
| `CONTRIBUTING.md` | Setup, browser development, TV deploy, PR conventions | Commands, tooling, scripts or contribution rules change |
| `docs/PERFORMANCE.md` | How speed is measured on a TV, the numbers, and the rules that came out of them | A change is measured on a TV, or changes how Home renders or the player starts |
| `docs/MAINTAINING.md` | What the PR automation does and the maintainer's steps | A workflow in `.github/workflows/`, a label or a repository setting changes |
| `CLAUDE.md` | Rules, commands, architecture and procedure for agents | Architecture, commands, rules or this table change |
| `TRADEMARK.md`, `brand/NOTICE` | What brand files are reserved outside the AGPL, and the name and fork policy | Brand files are added, moved or renamed, or the app ID changes |
| `brand/README.md`, `brand/store/LISTING.md` | Brand sources, render pipeline, store listing and submission checklist | Artwork, the render pipeline or the listing changes |
| `.claude/skills/*/SKILL.md` | Agent skills | The procedure a skill describes changes |

The README is public and user-facing: keep build and setup material in `CONTRIBUTING.md`, brand material in `brand/README.md`, and personal device or server details out of both.

## Local notes
- Never commit personal server URLs, tokens or `localStorage` backups. Any change to a TV's `localStorage` must back it up first and keep `silo-webos-device-id`. A `localStorage` backup alone no longer restores a sign-in: the tokens in it are encrypted under a key in the app's IndexedDB, which cannot be exported.
- Shell heredocs have hung the agent tool runner before. Prefer file edits or `sed`/`perl`.
- `getBrowseCatalogPage` and `getBrowseFilterOptions` in `src/api/silo.ts` are unused on purpose (parked for Global Browse, see `docs/DECISIONS.md`). Leave them.
