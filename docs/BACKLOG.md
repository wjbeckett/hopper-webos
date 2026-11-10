# Backlog

What Hopper still needs, what it deliberately does differently, and how far each shipped feature has been verified.

Hopper is its own client. The official Silo Android TV app (`silo-android/androidTvApp/`) is the reference to read first for behaviour, layout and server contracts, and many items below name the Android source to read. It is a reference, not a checklist: Hopper can differ on purpose, and each deliberate difference is recorded under "Where Hopper differs".

Say how far each item was verified: source, build, browser, live server or physical TV. Built is not the same as working on a TV.

## Open

### Features

- [ ] "Translate description" on detail pages (Android `TvDescriptionTranslationSection` + "Translated by AI" label). Player-side AI subtitle translation is already implemented (`AiTranslateDialog`); only the detail description workflow is missing.
- [ ] Music library Genres tab (Android `TvLibraryTab.Genres`): a new library tab with its own genre row and filtered grid. Not started.
- [ ] Settings load states: Android's "checking" and "Try Again" states are not built. A failed settings-contract load blocks the whole pane.
- [ ] Episode rail edge carousel on the detail page: not compared against Android.
- [ ] SiloControl receiver compatibility: listed as a target of the official TV clients. Not started and not evaluated.

### Player and device

- [ ] Verify Dolby Vision capability probing/profile advertisement and in-place setting restart on physical LG hardware. Never advertise DV Profile 7 on webOS.
- [ ] Physically verify the recent player/Up Next/On Deck sizing, skip and hold-seek indicators, focus behavior, spoiler handling, and detail theme music on representative webOS versions.
- [ ] Run a destination-by-destination side-by-side Android comparison; record each verified flow and remaining gap in this file.

### Audiobooks (on hold)

The Silo maintainer plans to rewrite this area, so these wait until the server side settles.

- [ ] Implement whole-book resume across multipart audiobooks. Never pin the first part's file when the requested book position belongs to a later part. The hero now sends a global resume value/0 for restart/undefined for fresh play (as Android does), but the webOS player has no part timeline/cross-part session orchestration yet.
- [ ] Add Android's dedicated audio player rather than routing audiobooks through video-player chrome.
- [ ] Match audiobook transport and back/focus behaviour. The shared player already has playback speed, sleep timer, chapter list and profile skip intervals; missing are bookmarks (Android `TvAudiobookBookmarksPanel`) and the audiobook-specific layout.
- [ ] Report whole-book progress and watched/finished state correctly; verify against Silo native playback contracts and Android's audiobook player/view model.
- [ ] Add tests for multi-part seek mapping, finished/restart state, chapter boundaries, and D-pad focus.
- [ ] Audiobook Authors/Series grids cover only the first audiobook library when there are several.

## Where Hopper differs

Deliberate differences from the Android TV app. Do not "fix" these to match Android without the maintainer's say-so. Add a line here whenever a new difference is decided.

- Diagnostics stay on the device. Hopper never uploads logs or reports to the hosted diagnostics collector, because the Silo maintainer does not accept reports from third-party clients. Logs can be viewed and exported locally.
- Hopper has its own name, mark, colours and startup animation. No Silo logo assets ship in the app.
- Watch Party is not built. Gate inspected on 2026-11-10: Android puts it behind a device-local Settings → Experimental → Watch Party toggle (`WatchPartyExperiment`, preference `silo_experimental`/`watch_party`) that defaults on in debug builds and off in release builds; turning it off hides every entry point. It is an opt-in experiment, not a shipped Android TV destination, so Hopper does not implement it and must not imply it is available. If product scope later requires it, implement the complete room lifecycle, realtime sync and player coordination, not just its hub screen.
- Sign-in, first-run setup and invite sign-up use Hopper's centred card layout, not Android's marquee layout with the "use your phone" card.
- Invite sign-up availability is probed when the password sign-in screen opens. Android probes it when the server is chosen.
- Text entry uses the webOS system keyboard on the focused field. Android's on-screen keyboard dialog is not ported.
- Details and the Home hero show a time-left ring for partly watched titles, in the brand teal. No equivalent was found in the Android TV source.
- Playback is always negotiated as HLS. Original-file and progressive delivery are switched off in the device profile, because the LG browser can report codec support and still reject the container.
- Audio delay is 0 to 1000 ms. Android allows -1000 to 1000 ms; a WebAudio `DelayNode` cannot move audio earlier. Keep the limit unless a TV-safe way to advance audio is shown not to make sync worse.
- The TV cannot browse the network for servers, because a web app has no mDNS. Phone pairing covers discovery (the phone finds the TV); manual entry and saved servers remain.
- Episode items open within the Series screen, which selects the relevant season; standalone episode/season pages are not webOS destinations.

## Not planned

- Ebook reading and phone-style downloads management are not exposed on TV unless product direction changes. Android TV hides ebook-like content too.
- Global Browse (`TvBrowseScreen`): Android registers `TvMainRoute.Browse`, but its only opener is Home's `onSeeAll`, which `TvHomeContent` never wires to a control, so no Android TV entry point reaches it. webOS ships no screen for it; `getBrowseCatalogPage`/`getBrowseFilterOptions` in `src/api/silo.ts` are ready if Android adds an entry point.
- Android TV has no navigation route to `TvInboxScreen`, so there is no Android TV inbox destination to reproduce.

## Shipped: verification status

What each shipped feature was checked against. Most have not been seen on a TV.

- Media artwork blur-up: added ThumbHash placeholder support (`poster_thumbhash`/`backdrop_thumbhash` plumbed from native API through `SiloItem`/`SiloCollection`, decoded to canvas data URLs with a 256-entry cache), a shared `ArtworkImage` component (thumbhash blur-up cover, 300ms crossfade, instant reveal under 100ms, deferred presentation while scrolling, `DefaultArtwork` fallback matching Android's `#16171C` base + brand glows at 0.176/0.144/0.112 alphas and white 13% mark at 24% width), and fixed card geometry (`.media-card { width: 100% }`, `position: relative` art boxes with only 2:3 / 16:9 / 1:1 aspects, absolutely positioned images, `decoding="async"` + explicit dimensions). Applied to `MediaCard`, episode tiles in `SeriesScreen`, and collection cards. Build-checked (`npm run build`); browser/physical-TV visual verification still pending. Decoder is from-scratch and should be spec-tested before claiming exact visual parity; full-size server asset URLs are still used (no per-slot sizing invented).
- Section Browse ("Explore all"): non-featured Home and library-Recommended rows cap at 20 cards and end with an Explore all card (Android `SECTION_ROW_MAX_ITEMS` / `offersExploreAll` / `TvExploreAllCard`). It opens the row's full page (`GET /catalog?source=section`, scope `home` or `library`, cursor-paged, ebook-like types hidden, mixed-library Movies/Series scope kept, 404 shown as "no longer available") inside the shell; Back returns focus to that row's Explore all card. Build-checked; browser/TV verification pending.
- Create/Edit profiles: profile picker gains Android's Manage/Done toggle and Add Profile tile, both gated on a household primary (`householdPrimary()`); a PIN-locked primary is verified first and its token is used only as the acting manager's `X-Profile-Id`/`X-Profile-Token` (never selected). Manage mode turns tiles into Edit. The shared form mirrors `TvProfileForm`: live preview tile, DiceBear Style chips + 18-avatar grid with Shuffle (deterministic `TvProfileAvatarPresets` seeds, `preset:dicebear:<style>:<seed>` refs), Name, PIN (optional, Remove), Child switch, Maximum rating ladder (G…NC-17, Any) with caption, All/Choose libraries with assignable library allowlist (`GET /api/v2/user/libraries` without profile headers, ebook-like hidden, Try Again on failure), error line and Create/Save. Validation and wire rules follow `TvCreate/EditProfileViewModel` + `ProfileAccessLimits` (duplicate-name pre-check, 4-digit PIN, choose-a-library, PATCH sends rating/allowlist only when changed, null clears rating/PIN). `POST /api/v2/profiles`, `PATCH /api/v2/profiles/{id}`. Profile delete (manage mode): a Delete button under every non-primary tile (the server refuses the primary, 409 `primary_profile_protected`) opens Android's two-option prompt ("Delete <name>?" / "Delete profile — This cannot be undone." / Cancel); `DELETE /api/v2/profiles/{id}` acting as the primary, then the list reloads; deleting this device's active profile drops the dead selection and requires a fresh pick; Back/Cancel return focus to the Delete button. Build-checked only; not exercised against a live server, in a browser or on a TV. Not ported: on-screen keyboard dialog (webOS uses its system keyboard on focused inputs).
- First-run setup: choosing a server without a saved session probes public `GET /api/v2/system/setup`; `needs_setup: true` routes to the setup screen (Android `TvSetupScreen` copy: "Set up your server", the-first-account note), which validates exactly as `TvSetupViewModel` (username, email with "@", password ≥ 8) and calls `POST /api/v2/auth/setup` once (201) — the returned token pair signs in and lands on profile selection. A failed probe keeps the normal sign-in. Build-checked only; not run against a fresh server. Invite-code self-signup is still needed and deferred to a future implementation (see Remaining exposed workflow gaps).
- Profile menu dropdown: Android row order and shell behavior (Switch Profile → Watchlist → Favorites → History → Settings → Switch Server → Sign Out), avatar header with server subtitle, SVG icons, modal focus trap, and action wiring. Build-checked; physical-TV visual confirm still pending.
- Profile selection layout: centered "Who's watching?" and signed-in header, centered round-avatar grid with circular Android-style focus treatment, Change server / Sign out actions, and no top navigation while switching profiles. PIN flow retained. Build-checked; visual and physical-TV confirmation pending.
- Audiobook detail hero, replacing the generic movie detail for audiobooks: book artwork, title, author, narrator, publisher, total duration, description, Resume/Play/Start Over semantics. Source/build checked; browser/TV visual check pending.
- Invite-code self-signup (Android `TvSignupScreen` + `TvSignupViewModel`): the password sign-in screen probes public `GET /api/v2/auth/signup` and offers "Create account" only when it reports `enabled` (a failed probe leaves it out). `SignupScreen` has Username, Email, Password and Invite code, validates in Android's order and wording, and calls `POST /api/v2/auth/signup` once (201) with `invite_code`; the returned token pair signs in and lands on profile selection. 409 shows "Username or email already in use", 403 "Invalid invite code". "Sign in instead" or Back returns to sign-in. Verified by build and in desktop Chrome against a mock server (probe, validation, 403, 201 to profile selection); the status probe's shape was also checked against `demo.siloserver.org`. Not verified: a real sign-up on a live server, and the remote and system keyboard on a TV. Differences: Android probes sign-up status when the server is chosen and passes it to Login, webOS probes when the password screen opens; webOS uses its card layout, not Android's marquee layout with the Use-phone card.
- Episode long-press menu on the detail episode rail: hold OK on an episode tile opens Play / Mark Watched-Unwatched / Add-Remove Favorite; Back or an action returns focus to the tile. Matches Android `TvDetailEpisodeRail` (`TvMediaCardActions` with `onSetWatched` + `onToggleFavorite`, no watchlist). Shipped in the 2026-10-29 rebuild; it was left unchecked here by mistake.
- LAN discovery via phone pairing: the bundled JS service (`services/pairing`, `com.hopperapp.hopper.service`) advertises `_silopair-roku._tcp` over mDNS; the Silo phone app's "Sign in on TV" finds the TV, pushes its server and approves the device login (`PhoneSetupScreen`, first screen when no server is saved). Manual entry and QR sign-in remain the fallback. Verified on a webOS 22 TV. Not done: the TV browsing for servers itself (a browser page has no mDNS).
- Cast/crew, trailers/extras, facts, person detail, and detail theme music are implemented.
- Episode spoiler overview/artwork handling is implemented using the profile's effective native settings and artwork provenance.
- On Deck card title/subtitle typography and spacing now match Android's `TvMediaCard` values at the webOS density mapping (source/build-checked, not visually verified on TV).
