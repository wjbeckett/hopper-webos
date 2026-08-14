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

## Branding
The Silo name/logo are trademarked separately from the AGPL code. Development can use a working name, but public store publishing needs the appropriate permission.
