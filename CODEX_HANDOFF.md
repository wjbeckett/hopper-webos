# Codex handoff

## Current build
Version: `0.2.0-dev`

## Start here on CachyOS

```bash
npm install
npm run build
npm run dev
```

Then connect the physical LG TV and:

```bash
WEBOS_DEVICE=livingroom npm run webos:deploy
WEBOS_DEVICE=livingroom npm run webos:inspect
```

## Validation status

Validated on the live Silo server in headless Chromium on 2026-10-30:

- TypeScript and Vite production builds pass.
- QR/device sign-in via v2 was approved and landed on Home. Password sign-in and token refresh remain unverified.
- Profiles, libraries, Home/library section items, favorites, watchlist, catalog search/detail, seasons, episodes, and effective settings were queried live. The TV home rendered its hero and content rails.
- Playback capabilities negotiation and v3 start returned a playable HLS plan. Progress returned 200 and stop returned 200 when sent the required installation id and stop id. Replan, track preference writes, and actual HLS playback/seek remain unverified.
- No physical LG webOS TV verification has been performed.

Do not treat `0.2.0-dev` as store-ready. The most important release blocker is
live validation of the native Silo contracts and negotiated playback routes. Do
not change endpoints or wire models by guessing; compare failures with the live
server and current official-client contract.

## Priority order

1. Verify password sign-in and token refresh against the live server.
2. Exercise remaining UI flows (favorites/watchlist toggles, collection items, season/episode navigation, search) end to end.
3. Verify playback replan, audio/subtitle preference writes, and actual HLS playback/seek against the live server.
4. Test playback routes on physical LG webOS hardware and capture client diagnostics.
