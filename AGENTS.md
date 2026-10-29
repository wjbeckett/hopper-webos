# Silo webOS agent notes

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

## Immediate next milestones
1. Device/QR login implemented from Silo's native `/api/v1/auth/device/start` + `/poll` contract; keep it primary and password as fallback.
2. Implement exact device profile + playback-v3 negotiation.
3. Add TV series -> seasons -> episodes navigation.
4. Add Continue Watching / Next Up sections.
5. Persist/report playback progress and watched state.
6. Add audio/subtitle track selection.
7. Implement LG Back key / media keys robustly.
8. Add search.
9. Add server discovery / connection management.
10. Add tests for spatial navigation and API parsing.

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
- Before claiming parity, compare every exposed destination and meaningful workflow against Android TV; call out unimplemented or server-unverified areas explicitly.
- Keep Silo endpoint and payload handling in `src/api`; mirror Android's documented native Silo contracts rather than inventing routes or substituting Jellyfin-compatible APIs.
- Recreate Android transitions with webOS-safe CSS and DOM behavior; avoid platform-specific Compose assumptions.

## Branding
The Silo name/logo are trademarked separately from the AGPL code. Development can use a working name, but public store publishing needs the appropriate permission.
