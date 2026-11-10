# Handoff: Hopper for LG webOS

Last updated 2026-11-10 (Hopper is its own client: Android TV is the reference, not the definition; `ANDROID_PARITY_TODO.md` became `BACKLOG.md`).

## Read first (in order)
1. `CLAUDE.md`: hard rules (no bulk overwrites; Android TV is the reference, not the definition; native Silo API only), architecture, TV navigation rules and webOS gotchas.
2. This file: current state, release blockers and open items. There is no change log file; the history is the merged pull requests (`gh pr list --state merged`).
3. `docs/BACKLOG.md`: open work, where Hopper deliberately differs from Android TV, what is not planned, and how far shipped features were verified.
4. `brand/README.md` and `brand/store/LISTING.md`: brand pipeline and store submission state.
5. `CONTRIBUTING.md`: setup, browser dev, TV deploy and PR conventions; `docs/MAINTAINING.md`: what the PR automation does and the maintainer's steps (public-facing; the README is user-facing only and carries the Availability table to update on store submission or release).

## Where things stand
- **App:** Hopper, `com.hopperapp.hopper` v0.3.0, pairing service `com.hopperapp.hopper.service`. React 19 + TS + Vite, packaged with `@webos-tools/cli`.
- **Recent work** (all on `main`):
  - Browse, Continue Watching and Details performance.
  - Faster playback start.
  - `ResumeProgress` time-left ring.
  - Rebrand to Hopper.
  - Aurora hopper icon, splash, store icon, banner and the `brand/render.sh` pipeline.
  - Animated startup splash. Reworked on 2026-11-10: the native splash is the backdrop only, and the tiles drop into the hopper one at a time.
  - Four store screenshots and a draft listing.
  - Licensed `AGPL-3.0-or-later`. Open: whether to reserve the Hopper name and `brand/` artwork with a `TRADEMARK.md`, as Silo does.
- **Verified on a physical TV:** BedroomTV, webOS on Chrome 87. The rebranded app installs and launches. The splash animation lands at 754,180 412×521, matching the native splash.
- **Uncommitted on purpose:** `.claude/settings.json` deletion is unrelated. Do not stage it.

## Issue and PR workflow (added 2026-11-10)
The maintainer's step-by-step, including what is automatic and what is manual, is `docs/MAINTAINING.md`. Contributors read `CONTRIBUTING.md`.
- **Flow for every change:** new branch off `main` → PR into `main`. `main` is the only long-lived branch; the `dev` branch was retired on 2026-11-10 and everything on it was merged into `main`. No direct commits to `main`. The full procedure is in `CLAUDE.md` under Development procedure.
- **Claude Code opens the PR for every change** (rule added 2026-11-10): one branch and one PR per change, opened ready for review once the work is verified and pushed. Commit messages carry no `Co-Authored-By` or "Generated with" lines.
- **`unslop` skill** (`.claude/skills/unslop/`, copied from the Silo server repository, AGPL-3.0, see its `SOURCE.md`): a final pass on PR text, issue and PR comments and review text. Both review workflows are told to apply it. Not yet seen running in a workflow.
- **`fix-issue` skill** (`.claude/skills/fix-issue/`): triages open issues, investigates, fixes on a branch off `main` and opens the PR. `.gitignore` lets `.claude/skills/` through; the rest of `.claude/` stays ignored. Not yet used on a real issue.
- **`claude-review.yml`** (PRs from branches in this repo): full review that may push `review: ` fix commits.
  - Confirmed on PR #3: runs end to end, updates one summary comment per PR, and reads the PR description from `.claude-review/pr-description.md`.
  - A PR that changes this file is not reviewed by it (the action requires the file to match `main`).
  - Still unconfirmed: that a `review: ` fix commit lands on the PR branch and does not start a second review. No PR has needed a fix yet.
- **`ci.yml`:** Build check (`npm ci`, `npm run build`) on every PR and on pushes to `main`. No secrets. Confirmed on PR #3.
- **`pr-intake.yml`:** `triage` labels every PR (size, area, `external`) and welcomes outside contributors. `external-review` is a read-only Claude review for fork PRs: Claude gets `main` plus the diff as a file and can only read; a script posts the result. First-time contributors need the `claude-review` label once.
  - Confirmed on GitHub with a manual run against PR #3 (Actions → PR intake → Run workflow): triage labelled the PR, Claude ran with read-only tools, returned its structured result, and the script posted the summary as `github-actions[bot]`.
  - Still unconfirmed: a real fork PR (none exists yet), the `claude-review` label path, and inline comments (that review had no findings; the script falls back to listing them in the summary if GitHub rejects them).
- **Issue forms and PR template** in `.github/`.
- **Needs the maintainer when the repository goes public:** branch protection on `main` requiring the `build` check (GitHub does not offer it on a private repository on the free plan), and the fork-workflow approval setting. Steps are in `docs/MAINTAINING.md` under Settings.

## Release blockers
What stands between the app and a store release. Update an item when its state changes.

1. **Playback contract:** validate the protocol-v3 planner and replan handling against a live server and the official clients' behaviour.
2. **Session expiry:** token refresh is implemented (`POST /api/v2/auth/refresh`, single-flight per server and user). Open: a forced-expiry test against a live server, and the expired-session and network-loss screens.
3. **Catalog contract:** validate the native catalog endpoints and response models against a live server.
4. **Profiles:** create, edit and delete are implemented and build-checked. Invite-code sign-up is implemented and checked against a mock server. Open: live-server validation and a TV check for all of them.
5. **Progress reporting:** validate playback progress and stop reporting and the watched thresholds against a live server.
6. **Subtitles and skip controls:** implemented. Open: cue styling on a TV across webOS versions, and the audio and subtitle pickers against a live server.
7. **Codec matrix:** validate codecs and containers on at least one older and one current webOS generation.
8. **Automated tests:** none exist. Needed for navigation geometry, auth state, API parsing and player state.
9. **Store submission:** icons, splash, banner, four screenshots and a draft listing are done (`brand/store/LISTING.md`). Open: the items under "Blocked on the user" below, an accessibility pass and LG's certification checklist.
10. **Android TV comparison:** a destination-by-destination comparison on a physical TV has not been done. Known open points: Back does not always return to the originating screen, Home metadata enrichment and LG-remote focus transitions are unverified, and the sampled Home tint depends on artwork CORS behaviour that has not been checked on a TV. Open features are in `docs/BACKLOG.md`.

## Open items

### Blocked on the user (do not attempt)
- The demo server operator has to allow LG reviewers to use `demo`/`demo` and keep the server up.
- Permission to name Silo in the store listing.
- LG Seller Lounge asset spec check.
- "Hopper" trademark and store-name clearance.
- A privacy policy URL.

### Small, ready to pick up
1. Cold-relaunch on the paired TV and confirm the reworked startup splash (backdrop-only native splash, then the animation from an empty stage, smooth on Chrome 87) and the top-nav `HopperLockup` in the live flow. The splash only shows when a server is saved; with no server the app opens on pairing.
2. Optional: player screenshot via the TV's own screen capture, added to `brand/store/screenshots/05-player.png` and the listing.

### Larger work
- Dedicated audiobook player:
  - Whole-book multi-part timeline and resume.
  - Chapters, bookmarks, sleep timer, speed and skip intervals.
- "Translate description" on detail pages (needs the metadata-AI capability probe, pending-translation fields and a polled job; verify on a server with AI configured). Audiobook bookmarks.
- Invite-code sign-up is implemented (`SignupScreen`). Still to do: a real sign-up on a live server with sign-ups enabled, and a remote/keyboard check on a TV.
- Music library Genres tab (Android `TvLibraryTab.Genres`).
- Expired-session and network-loss UX. Token refresh itself is implemented in `src/api/silo.ts`.
- Codec/container matrix on an older and a current webOS generation.
- Automated tests (none exist): API parsing, auth state, navigation geometry, player state.
- Side-by-side Android TV comparison of every destination, run on a physical LG TV. Confirm playback, remote focus and device-specific capabilities.
- Watch Party: evaluated 2026-11-10 and not implemented, by decision. Android hides it behind a Settings → Experimental toggle that is off by default in release builds (details in `BACKLOG.md`).

## Working notes
- **Before you change anything:** read the matching Android source in `silo-android/androidTvApp/` and check "Where Hopper differs" in `docs/BACKLOG.md`. Make targeted edits only. Work on a branch off `main` (see Development procedure in `CLAUDE.md`). Run `npm run build`, then commit and push the branch after each verified step, and open a pull request into `main`. In the same change, update every doc it affects (the table under "Docs to keep current" in `CLAUDE.md`), saying what was verified and how (build, browser, live server or physical TV).
- **webOS Chrome 87:**
  - No `:has()`.
  - SVG CSS transforms need `transform-box: fill-box`.
  - Video renders on a hardware layer, so inspector screenshots show a blank player.
- **Brand changes:** edit the SVG in `brand/` and `src/components/HopperMark.tsx` together, then run `brand/render.sh` (macOS: Chrome + `sips`). Quick Look distorts non-square SVGs.
- **Deploy:** `WEBOS_DEVICE=<name> npm run webos:deploy`. Inspect with `npm run webos:inspect`.
- **TV helper scripts:** ad-hoc CDP scripts used for screenshots and server switching lived in `/tmp/cdp/` on the last workstation. They are not in the repo and may be gone. Anything that touches the TV's `localStorage` must back it up first and keep `silo-webos-device-id`.
- **Tool runner:** shell heredocs have hung the agent tool runner. Use file edits or `sed`/`perl` instead.
- **Personal data:** never commit personal server URLs, tokens or `localStorage` backups.
- **Unused code fails the build** (since the 2026-11-10 cleanup): `noUnusedLocals` and `noUnusedParameters` are on. `getBrowseCatalogPage` and `getBrowseFilterOptions` in `src/api/silo.ts` are unused on purpose (parked for Global Browse).
