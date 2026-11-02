# Silo webOS agent notes

## Hard rules (always apply)
1. Never overwrite the entire codebase. No bulk checkouts, resets, restores, regenerations, or whole-tree copies over `src/`. Make targeted edits to specific files only; rewrite a whole file only when that single file requires it. Commit to `dev` after each verified step so work is never held only in the working tree.
2. The Android TV app (`./silo-android/androidTvApp/...`) is the reference for design and behaviour. Read the relevant Android source before building or changing any screen, component, focus flow, or server action, and match it as closely as webOS allows. Deviate only where the user has explicitly decided (see `docs/FIRST_GRADE_ROADMAP.md` and `docs/RECONSTRUCTION.md`).

## Goal
Build a first-class LG webOS TV client for Silo with feature parity directionally matching the official Apple tvOS and Android TV clients.

## Platform
- Primary developer workstation: CachyOS / Arch Linux
- Frontend: React + TypeScript + Vite
- Target: LG webOS TV packaged web app
- Packaging/deployment: LG `@webos-tools/cli`

## Architecture rules
- Keep Silo API access under `src/api`.
- Use only Silo's native API. Never use Jellyfin-compatible endpoints, headers, models, or playback URLs.
- Keep LG/webOS-specific behavior under `src/platform`.
- Keep remote/focus behavior under `src/navigation`.
- Do not scatter raw API URLs through UI components.
- Prefer direct play when the TV supports it, but playback must ultimately be negotiated through Silo PlaybackInfo/device profiles.
- Treat the current `directVideoUrl()` implementation as temporary scaffolding.

## Remaining parity milestones
1. Complete audiobook detail and dedicated player workflows against Android TV (whole-book resume, multipart playback, chapters, bookmarks, sleep, speed and skip intervals); current webOS audiobook detail/player still share generic movie/video flows.
2. Evaluate Android TV's release-disabled experimental Watch Party for webOS; do not claim parity unless the full server-backed room workflow and remote focus/back behavior are implemented.
3. Add LAN server discovery only if webOS exposes a supported discovery API; browser-based mDNS is unavailable, so preserve manual and saved-server management meanwhile.
4. Finish episode long-press actions, detail translation controls, and any remaining destinations identified by the side-by-side Android parity audit.
5. Run end-to-end Android comparison on a physical LG TV for every exposed destination, including confirmation of playback, remote focus and device-specific capabilities.
6. Keep audio delay at 0..1000 ms unless a webOS-safe negative-delay implementation is demonstrated; Android supports -1000..1000 ms, while WebAudio DelayNode cannot advance audio.
7. Maintain native Silo API parsing/playback tests and spatial-navigation regression coverage as workflows are completed.

The source/build-only status, verified parity and explicit gaps are recorded in `docs/FIRST_GRADE_ROADMAP.md`; prioritized remaining work is in `docs/ANDROID_PARITY_TODO.md`. Update both after every verified step.

## UX
This is a 10-foot UI. Every interactive element must be reachable with Up/Down/Left/Right/OK/Back. Mouse/pointer support is secondary.

## TV navigation and browsing
- Keep focus on the intended control across screen transitions; request initial content focus only after focusable content exists.
- Handle OK/Enter once per remote press. Consume the matching key-up when activation changes screens so the same press cannot activate a newly focused control.
- Keep stable item keys and append cursor pages in the API's requested order. Do not re-sort already-rendered results when a later page arrives; preserving focus and scroll position is more important than recomputing the full list.
- When focus reaches the loaded edge of a paged grid, load the next page without moving the current selection until a destination card is available.
- Use the Android TV client as a UX reference for grid focus restoration and pagination, while keeping implementation native to React and webOS.

## Android TV parity
- Treat the current Silo Android TV app as the behavioral and visual reference for screens, menus, focus/back flows, and server-backed actions.
- Before claiming parity, compare every exposed destination and meaningful workflow against Android TV; call out unimplemented or server-unverified areas explicitly. Diagnostics is an explicit policy exception: the Silo maintainer will not accept reports from third-party clients, so the webOS app must not integrate with the hosted diagnostics collector or imply that it collects/uploads reports.
- Keep Silo endpoint and payload handling in `src/api`; mirror Android's documented native Silo contracts rather than inventing routes or substituting Jellyfin-compatible APIs.
- Recreate Android transitions with webOS-safe CSS and DOM behavior; avoid platform-specific Compose assumptions.

## Branding
The Silo name/logo are trademarked separately from the AGPL code. Development can use a working name, but public store publishing needs the appropriate permission.
