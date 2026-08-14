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

Validated on the CachyOS workstation on 2026-08-13:

- `npm install` completed with no reported vulnerabilities.
- `npm run build` completed successfully with TypeScript 5.7 and Vite 6.
- The device-login implementation is wired to Silo's native `/api/v1/auth/device/start` and `/poll` flow, but still needs verification against the user's live Silo server.
- Protocol-v3 playback start/replan, lifecycle progress/stop reporting, HLS execution,
  audio/subtitle selection, quality selection, seeking, and chapter markers are
  implemented and compile successfully, but still need verification against the
  user's live Silo server and physical LG hardware.

Do not treat `0.2.0-dev` as store-ready. The most important release blocker is
live validation of the native Silo contracts and negotiated playback routes. Do
not change endpoints or wire models by guessing; compare failures with the live
server and current official-client contract.

## Priority order

1. Verify QR/device sign-in against the user's live Silo server.
2. Verify Home/Movies/TV/Search against the live catalog.
3. Verify playback-v3 start, replan, progress, and stop payloads against the live server.
4. Exercise direct/remux/transcode, seek, quality, audio, and subtitle paths.
5. Test those routes on physical LG webOS hardware and capture client diagnostics.
