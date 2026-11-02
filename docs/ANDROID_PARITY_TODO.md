# Android TV parity TODO

Status as of 2026-11-02. Compare against `silo-android/androidTvApp/` before implementing each item, then update this list and `FIRST_GRADE_ROADMAP.md` with source/build/browser/physical-TV verification status. The Android TV client is the behavior and design reference; do not label work complete from compilation alone.

## Next: dedicated audiobook experience

- [x] Replace generic movie detail for audiobooks with Android's audiobook hero: book artwork, title, author, narrator, publisher, total duration, description, Resume/Play/Start Over semantics. Source/build checked; browser/TV visual check pending.
- [ ] Implement whole-book resume across multipart audiobooks. Never pin the first part's file when the requested book position belongs to a later part. The hero now sends a global resume value/0 for restart/undefined for fresh play (as Android does), but the webOS player has no part timeline/cross-part session orchestration yet.
- [ ] Add Android's dedicated audio player rather than routing audiobooks through video-player chrome.
- [ ] Match audiobook transport actions, skip interval settings, speed, sleep timer, chapters, bookmarks, and back/focus behavior.
- [ ] Report whole-book progress and watched/finished state correctly; verify against Silo native playback contracts and Android's audiobook player/view model.
- [ ] Add tests for multi-part seek mapping, finished/restart state, chapter boundaries, and D-pad focus.

## Remaining exposed workflow gaps

- [ ] Episode long-press/context menu parity on the detail episode rail (Android actions and focus restoration).
- [ ] Android detail translation controls and their native server workflow, if the TV build exposes them for the item/capability.
- [ ] Revisit LG server discovery only if webOS provides a supported LAN discovery mechanism. Android uses mDNS; no browser mDNS implementation is planned. Saved-server management/manual entry already exist, but profile-selection landing after server switch is not identical.
- [ ] Inspect the Android TV app's release-build gates for Watch Party. It is experimental and disabled in Android release builds; do not imply it is available on webOS. If product scope later requires it, implement the complete room lifecycle/realtime sync/player coordination, not just its hub screen.

## Player/device differences and validation

- [ ] Negative audio delay: Android allows -1000..1000 ms; current WebAudio DelayNode supports only 0..1000 ms. Keep the limitation explicit unless a TV-safe implementation can advance audio without introducing worse sync behavior.
- [ ] Verify Dolby Vision capability probing/profile advertisement and in-place setting restart on physical LG hardware. Never advertise DV Profile 7 on webOS.
- [ ] Physically verify the recent player/Up Next/On Deck sizing, skip and hold-seek indicators, focus behavior, spoiler handling, and detail theme music on representative webOS versions.
- [ ] Run a destination-by-destination side-by-side Android comparison; record each verified flow and remaining gap in `FIRST_GRADE_ROADMAP.md`.

## Explicitly not outstanding

- Cast/crew, trailers/extras, facts, person detail, and detail theme music are implemented.
- Episode spoiler overview/artwork handling is implemented using the profile's effective native settings and artwork provenance.
- Android TV has no navigation route to `TvInboxScreen`, so there is no Android TV inbox destination to reproduce.
- Episode items open within the Series screen, which selects the relevant season; standalone episode/season pages are not webOS destinations.
- On Deck card title/subtitle typography and spacing now match Android's `TvMediaCard` values at the webOS density mapping (source/build-checked, not visually verified on TV).
