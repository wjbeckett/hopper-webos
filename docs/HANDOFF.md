# Handoff: Hopper for LG webOS

Last updated 2026-11-10 (issue-fix skill, automated PR review, build check and fork PR intake added).

## Read first (in order)
1. `CLAUDE.md`: hard rules (no bulk overwrites; Android TV is the reference; native Silo API only), architecture, TV navigation rules and webOS gotchas.
2. `docs/FIRST_GRADE_ROADMAP.md`: verified features, release blockers and the change log (newest entries at the bottom).
3. `docs/ANDROID_PARITY_TODO.md`: prioritised parity gaps.
4. `brand/README.md` and `brand/store/LISTING.md`: brand pipeline and store submission state.
5. `CONTRIBUTING.md`: setup, browser dev, TV deploy and PR conventions; `docs/MAINTAINING.md`: what the PR automation does and the maintainer's steps (public-facing; the README is user-facing only and carries the Availability table to update on store submission or release).

## Where things stand
- **App:** Hopper, `com.hopperapp.hopper` v0.3.0, pairing service `com.hopperapp.hopper.service`. React 19 + TS + Vite, packaged with `@webos-tools/cli`.
- **Recent work** (all on `dev`):
  - Browse, Continue Watching and Details performance.
  - Faster playback start.
  - `ResumeProgress` time-left ring.
  - Rebrand to Hopper.
  - Aurora hopper icon, splash, store icon, banner and the `brand/render.sh` pipeline.
  - Animated startup splash that lines up with `public/splash.png`.
  - Four store screenshots and a draft listing.
- **Verified on a physical TV:** BedroomTV, webOS on Chrome 87. The rebranded app installs and launches. The splash animation lands at 754,180 412×521, matching the native splash.
- **Uncommitted on purpose:** `.claude/settings.json` deletion is unrelated. Do not stage it.

## Issue and PR workflow (added 2026-11-10)
The maintainer's step-by-step is `docs/MAINTAINING.md`; contributors read `CONTRIBUTING.md`.
- **Flow for every change:** new branch off `dev` → PR into `dev` → release PR `dev` → `main` after TV testing. No direct commits to `dev` or `main`. The full procedure is in `CLAUDE.md` under Development procedure.
- **`fix-issue` skill** (`.claude/skills/fix-issue/`): triages open issues, investigates, fixes on a branch off `dev` and drafts the PR. `.gitignore` lets `.claude/skills/` through; the rest of `.claude/` stays ignored. Not yet used on a real issue.
- **`claude-review.yml`** (PRs from branches in this repo): reviews non-draft PRs into `dev` (may push `review: ` fix commits) and `main` (comment only).
  - Confirmed on PR #3: runs end to end, updates one summary comment per PR, and reads the PR description from `.claude-review/pr-description.md`.
  - It must be identical on `main`, the default branch, or the action skips the review with a green check and no comment.
  - Still unconfirmed: that a `review: ` fix commit lands on the PR branch and does not start a second review. PR #3 had nothing to fix.
- **`ci.yml`:** Build check (`npm ci`, `npm run build`) on every PR and on pushes to `dev` and `main`. No secrets.
- **`pr-intake.yml`:** `triage` labels every PR (size, area, `external`), moves fork PRs from `main` to `dev` and welcomes outside contributors. `external-review` is a read-only Claude review for fork PRs: Claude gets the base branch plus the diff as a file and can only read; a script posts the result. First-time contributors need the `claude-review` label once.
  - Checked so far: workflow lint, and the two inline scripts against a mocked GitHub API. Not yet run on GitHub. No fork PR exists to test with; use "Run workflow" with a PR number to exercise the review path.
  - Unverified assumptions to watch on the first run: that the Claude action accepts `workflow_dispatch` and `pull_request_target` with `github_token` and no `id-token` permission, and that `structured_output` is populated (the post step falls back to the execution file).
- **Issue forms and PR template** in `.github/`. They take effect from `main`.
- **Before going public:** branch protection on `dev` and `main` requiring the `build` check, and the fork-workflow approval setting. See `docs/MAINTAINING.md`.

## Open items

### Blocked on the user (do not attempt)
- The demo server operator has to allow LG reviewers to use `demo`/`demo` and keep the server up.
- Permission to name Silo in the store listing.
- LG Seller Lounge asset spec check.
- "Hopper" trademark and store-name clearance.
- A privacy policy URL.

### Small, ready to pick up
1. Define `--accent: #2DD4BF` (brand teal) in `src/styles.css` `:root`. Today the ring falls back to `#2f6bff` (`src/styles.css` around line 3974). Check every other `var(--accent, …)` use before changing it.
2. Cold-relaunch on the paired TV and confirm the real startup splash and the top-nav `HopperLockup` in the live flow. The splash only shows when a server is saved; with no server the app opens on pairing.
3. Optional: player screenshot via the TV's own screen capture, added to `brand/store/screenshots/05-player.png` and the listing.

### Larger work (from the roadmap and parity TODO)
- Dedicated audiobook player:
  - Whole-book multi-part timeline and resume.
  - Chapters, bookmarks, sleep timer, speed and skip intervals.
- "Translate description" on detail pages; invite-code sign-up; audiobook bookmarks.
- Expired-session and network-loss UX. Token refresh itself is implemented in `src/api/silo.ts`.
- Codec/container matrix on an older and a current webOS generation.
- Automated tests (none exist): API parsing, auth state, navigation geometry, player state.
- Side-by-side Android TV comparison of every destination, run on a physical LG TV. Confirm playback, remote focus and device-specific capabilities.
- Evaluate Android TV's Watch Party, which is experimental and disabled in Android release builds. Don't claim parity unless the full server-backed room workflow and remote focus/back behaviour are implemented.

## Working notes
- **Before you change anything:** read the matching Android source in `silo-android/androidTvApp/`. Make targeted edits only. Work on a branch off `dev` (see Development procedure in `CLAUDE.md`). Run `npm run build`, then commit and push the branch after each verified step, and get it into `dev` through a pull request. Update the roadmap and parity TODO with what was verified and how (build, browser or physical TV).
- **webOS Chrome 87:**
  - No `:has()`.
  - SVG CSS transforms need `transform-box: fill-box`.
  - Video renders on a hardware layer, so inspector screenshots show a blank player.
- **Brand changes:** edit the SVG in `brand/` and `src/components/HopperMark.tsx` together, then run `brand/render.sh` (macOS: Chrome + `sips`). Quick Look distorts non-square SVGs.
- **Deploy:** `WEBOS_DEVICE=<name> npm run webos:deploy`. Inspect with `npm run webos:inspect`.
- **TV helper scripts:** ad-hoc CDP scripts used for screenshots and server switching lived in `/tmp/cdp/` on the last workstation. They are not in the repo and may be gone. Anything that touches the TV's `localStorage` must back it up first and keep `silo-webos-device-id`.
- **Tool runner:** shell heredocs have hung the agent tool runner. Use file edits or `sed`/`perl` instead.
- **Personal data:** never commit personal server URLs, tokens or `localStorage` backups.
