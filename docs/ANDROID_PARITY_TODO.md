# Android TV parity TODO

Status as of 2026-11-05. Compare against `silo-android/androidTvApp/` before implementing each item, then update this list and `FIRST_GRADE_ROADMAP.md` with source/build/browser/physical-TV verification status. The Android TV client is the behavior and design reference; do not label work complete from compilation alone.

## Completed this pass

- [x] Media artwork blur-up parity: added ThumbHash placeholder support (`poster_thumbhash`/`backdrop_thumbhash` plumbed from native API through `SiloItem`/`SiloCollection`, decoded to canvas data URLs with a 256-entry cache), a shared `ArtworkImage` component (thumbhash blur-up cover, 300ms crossfade, instant reveal under 100ms, deferred presentation while scrolling, `DefaultArtwork` fallback matching Android's `#16171C` base + brand glows at 0.176/0.144/0.112 alphas and white 13% mark at 24% width), and fixed card geometry (`.media-card { width: 100% }`, `position: relative` art boxes with only 2:3 / 16:9 / 1:1 aspects, absolutely positioned images, `decoding="async"` + explicit dimensions). Applied to `MediaCard`, episode tiles in `SeriesScreen`, and collection cards. Build-checked (`npm run build`); browser/physical-TV visual verification still pending. Decoder is from-scratch and should be spec-tested before claiming exact visual parity; full-size server asset URLs are still used (no per-slot sizing invented).
- [x] Section Browse ("Explore all"): non-featured Home and library-Recommended rows cap at 20 cards and end with an Explore all card (Android `SECTION_ROW_MAX_ITEMS` / `offersExploreAll` / `TvExploreAllCard`). It opens the row's full page (`GET /catalog?source=section`, scope `home` or `library`, cursor-paged, ebook-like types hidden, mixed-library Movies/Series scope kept, 404 shown as "no longer available") inside the shell; Back returns focus to that row's Explore all card. Build-checked; browser/TV verification pending.
- [x] Create/Edit profiles: profile picker gains Android's Manage/Done toggle and Add Profile tile, both gated on a household primary (`householdPrimary()`); a PIN-locked primary is verified first and its token is used only as the acting manager's `X-Profile-Id`/`X-Profile-Token` (never selected). Manage mode turns tiles into Edit. The shared form mirrors `TvProfileForm`: live preview tile, DiceBear Style chips + 18-avatar grid with Shuffle (deterministic `TvProfileAvatarPresets` seeds, `preset:dicebear:<style>:<seed>` refs), Name, PIN (optional, Remove), Child switch, Maximum rating ladder (G…NC-17, Any) with caption, All/Choose libraries with assignable library allowlist (`GET /api/v2/user/libraries` without profile headers, ebook-like hidden, Try Again on failure), error line and Create/Save. Validation and wire rules follow `TvCreate/EditProfileViewModel` + `ProfileAccessLimits` (duplicate-name pre-check, 4-digit PIN, choose-a-library, PATCH sends rating/allowlist only when changed, null clears rating/PIN). `POST /api/v2/profiles`, `PATCH /api/v2/profiles/{id}`. Build-checked only; not exercised against a live server, in a browser or on a TV. Not ported: profile delete (Android manage-mode delete prompt), on-screen keyboard dialog (webOS uses its system keyboard on focused inputs).
- [x] Profile menu dropdown parity: Android row order and shell behavior (Switch Profile → Watchlist → Favorites → History → Settings → Switch Server → Sign Out), avatar header with server subtitle, SVG icons, modal focus trap, and action wiring. Build-checked; physical-TV visual confirm still pending.
- [x] Profile selection layout: centered "Who's watching?" and signed-in header, centered round-avatar grid with circular Android-style focus treatment, Change server / Sign out actions, and no top navigation while switching profiles. PIN flow retained. Build-checked; visual and physical-TV confirmation pending.

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
- Global Browse (`TvBrowseScreen`): Android registers `TvMainRoute.Browse`, but its only opener is Home's `onSeeAll`, which `TvHomeContent` never wires to a control, so no Android TV entry point reaches it. webOS ships no screen for it; `getBrowseCatalogPage`/`getBrowseFilterOptions` in `src/api/silo.ts` are ready if Android adds an entry point.
- Android TV has no navigation route to `TvInboxScreen`, so there is no Android TV inbox destination to reproduce.
- Episode items open within the Series screen, which selects the relevant season; standalone episode/season pages are not webOS destinations.
- On Deck card title/subtitle typography and spacing now match Android's `TvMediaCard` values at the webOS density mapping (source/build-checked, not visually verified on TV).
