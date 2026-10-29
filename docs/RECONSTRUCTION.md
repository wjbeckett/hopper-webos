# Reconstruction Plan

Written 2026-10-29 after the 19:41 working-tree regression (entire `src/` overwritten by an
older state; no snapshots captured the lost layer). This document is the source of truth for
rebuilding. All behaviours below were verified working on a TV or against the live server
before the loss, and most were verified against the Android TV reference
(`silo-android/androidTvApp`, now cloned into this workspace) or the server OpenAPI spec.

Recovery sources, in order of authority:
1. This document (decisions + behaviour specs distilled from the chat history).
2. The Android TV source at `./silo-android` — the parity reference.
3. The live server API spec: `https://silo.example.com/api/v2/docs` (OpenAPI JSON at
   `/api/v2/openapi.json`, ~730 paths; a copy was fetched to `/tmp/silo-spec.json` — re-fetch
   if missing).
4. The surviving code (post-regression tree, commit `d008042`).
5. Chat history: full source survives for `icons.tsx`, `watchState.ts`, the card context
   menu component, and the exact edit strings for the nav ladder / modal lock / long-press /
   episode-rail CSS (turns after ~turn 40). Older files: behaviour only.

## Loss inventory (as of d008042)

Gone entirely (files): `components/DetailSections.tsx`, `components/icons.tsx`,
`components/PlaybackOptions.tsx`, `core/watchState.ts`, `platform/youtube.ts`,
`screens/AudiobookGroupsScreen.tsx`, `screens/PersonScreen.tsx`, `api/events.ts`.

Gone from surviving files:
- `navigation/spatial.ts`: season-pill ladder, modal focus trap, long-press pending-press
  handling, first-content-focus retry, remembered-episode Up/Down rules.
- `screens/SeriesScreen.tsx`: action-button icon-collapse row, playback summary placement,
  merged Android metadata row, focused-episode hero, rail wrapper structure.
- `screens/DetailsScreen.tsx`: cast/trailers/related sections, facts table, Options dialog.
- `components/MediaCard.tsx`: hold-OK context menu, watch bus subscription, wrapper.
- `api/silo.ts`: people, filmography, trailers/extras, similar, audiobook-groups,
  events ws-ticket, theme audio endpoints.
- App wiring: events socket, watch-bus refresh of Home/ForYou/Library rails.

Survives: auth device flow, catalog/browse (+panels, filters, sort, prefix), collections,
history, calendar, requests, profiles/settings, playback v3 start, watched/favorite/watchlist
APIs, shuffle APIs, media rails, TopNav.

## Focus grammar (Android `FocusModifier.kt` / `Color.kt`) — RE-VERIFIED LIVE 10-29

- Cards (poster/collection/request): scale **1.10**, glow `0 0 24px rgba(255,255,255,.28)`.
- Episode tiles: scale **1.04** + same glow on focus only; the non-focused
  "currently playing" tile is a soft lift + dim, no scale.
- Pills / chips / buttons: scale **1.06**, no border, shadow lift.
- **No white borders/rings anywhere on focus** (explicit user rejection: "ugly"). Focus =
  scale + glow + drop shadow. Kept outlines only on non-enlarging controls (search input,
  PIN pad, season/library tab pills need visible focus but do not enlarge — they may keep a
  white outline; re-check during rebuild).
- Glow rationale (Android comment): 0.08 alpha is invisible on OLED black; must read at 10 ft.
- Implemented as an appended override section in `styles.css` in commit d008042 — fold it
  into the main ruleset during rebuild instead of appending.

## Layout / rail rules (verified rendered, then live on server data)

- Episode rail: **full-bleed to both screen edges** (`margin: -8px -58px 0 -58px;
  padding-left: 58px; padding-right: 0`), boundary tiles cut at the physical screen edge.
- End gutter rides **inside the scroll as a flex spacer** (`::after` with
  `flex: 0 0 6vw; min-width: 58px; max-width: 112px`) — never `padding-right` on the
  scroller: older TV web engines exclude end padding from the scrollable area, which left
  the last tile flush with its focus ring shaved.
- Tile sizing lives on the wrapper (`.episode-tile-wrap { flex: 0 0 clamp(220px,18vw,330px);
  min-width: 0 }`), tile `display:block; width:100%` inside. If a wrapper div is introduced
  for menus/portals, the flex item must carry the sizing (this exact bug caused stacked tiles).
- Media rails are CSS grid with fixed auto-columns — wrappers are safe there.
- Scrollbars hidden globally (`::-webkit-scrollbar { display:none }`, `scrollbar-width:none`).

## Series screen (Android `TvItemDetailScreen` / `TvDetailHero` / `TvDetailMetadata`)

- Season pills only (no "Show" pill); focusing a pill selects that season, resets its rail
  to scroll 0, focus stays on the pill.
- Entry: from Browse/Related/Search → season 1 (first non-specials), Play targets its first
  episode; focus starts on Play. A specific episode is preselected ONLY when arriving with
  one (Continue Watching / Next Up / direct episode open).
- Hero metadata row (merged, chip first): content-rating chip; on episode focus
  `Season X · Episode Y` + abbreviated air date (`Mon D, YYYY`) + runtime (`1h 32m` /
  `52 min`); otherwise `TV Show` + up to 2 genres + year + `N Seasons`; rating chip and
  `★ x.x` show on both states.
- Episode name + overview go in the 3-line synopsis slot as `Name · overview`; the
  Starring credit line NEVER swaps on episode focus (Android: "credit must never jump").
- VERSION / AUDIO / SUBTITLES summary sits directly above the action row (gap 28px above,
  8px below to buttons).
- Action row: collapsed 50px icon circles (inline SVG, never glyph fonts — TV font lacks ▶/⚙);
  focused one expands to a pill revealing its label (~220ms). **Play stays pinned open** while
  focus is anywhere outside the row (label tracks the focused/next-up episode:
  `Play S4:E6` / `Resume S4:E6 12:34`); Play collapses only when another row button is focused.
- More menu rows, Android order: Shuffle Series (if capable), Shuffle Season (if ≥2 eps and
  capable), Favorite toggle, **Mark Episode Watched/Unwatched** (targets focused/next-up),
  Mark Series Watched/Unwatched, Mark Season Watched/Unwatched.
- Navigation ladders (all verified):
  - Up from episode row → active season pill; Up from pill → Play.
  - Down from any action button → remembered episode card (`data-last-episode` on
    `.series-screen`), else active pill; Down from pill → first episode of that season.
  - Up from Cast/Trailers/Recommended → remembered episode card, else pill (no row skipping).
  - Down from lower sections → active pill.
  - Left/Right inside episode/cast/trailer rows never leave the row; at row ends inert.
  - Cross-season jump at rail edge: removed (Android supports via picker; we chose inert).
- Episode long-press menu (hold OK 500ms): Play, Mark Watched/Unwatched, Add to Favorites.
  Quick press still plays (deferred click: keydown arms 500ms timer; keyup before it fires
  clicks the card; keyup after is swallowed). Menu is modal (`data-modal="true"`), focus
  returns to the card on close.

## Modal focus trap (generic)

- Any open dialog scrim carries `data-modal="true"`.
- While open, all four arrows are consumed by the trap: Up/Down move within the dialog's
  focusables (inert at the ends — must NOT reach the page behind), Left/Right consumed,
  focus outside snaps to the first dialog row.
- Back/Escape close; focus returns to the spawning button.

## Playback / pre-play (server-verified against live API)

- `POST /playback/start` (v3 body). Track picks: **audio and subtitle use ordinals into the
  file's track list** (server-verified; stream indexes are silently ignored).
  Subtitle Off at start = `subtitle_track_index: -1` (verified).
- Auto version resolution: prefer `user_data.last_file_id` from the watch detail, then best
  resolution by bitrate. Pre-play version choice is NOT persisted (Android parity).
- Audio/subtitle prefs persist per series: `PUT/DELETE /audio-prefs/{series_id}`,
  `PUT/DELETE /subtitle-prefs/{series_id}` with `*_track_index`, `*_language`,
  `track_signature {language,title,embedded_title,codec,layout,channels}` (audio adds
  `default`; we omit it like Android, server fills it). Subtitle signature adds
  `source,label,forced,hearing_impaired`. Body shapes verified PUT→204→GET round-trip.
- Choices reset when the focused episode changes. Editions grouping via
  `playback_variants[].presentation_group_key` (spec-confirmed; live server currently
  returns single-edition, so flat list + Auto is the live path).
- Pre-play UI: one "Options" dialog (user-preferred deviation from Android's three pills).

## Player remote grammar (LG webOS)

- Back key: `Escape`, `Backspace`, `GoBack`, keyCode **461** and **10009**.
- Panel open: panel owns the remote — Up/Down cycle panel rows, Left/Right consumed,
  Back closes panel; global nav must not steal focus.
- No panel: OK toggles play/pause (unless a HUD control is focused — then it activates),
  ◀/▶ seek ∓10s, MediaPlay/MediaPause/MediaPlayPause/MediaStop/MediaFastForward(+30s)/
  MediaRewind(−30s) all handled, any keypress reveals the HUD.
- HUD buttons (Audio/Subtitles/Quality/Back) need `data-tv-focusable="true"`.
- App-level Back must early-return while `.player-shell` is mounted (player owns Back;
  return goes to series/detail, not Home).
- On exit: report elapsed seconds; on natural end: mark watched. Both feed the watch bus.

## Watch-state bus (`core/watchState.ts`) — full source recoverable from chat

- `publishWatchState(item)` / `subscribeWatchState(listener)` / `applyWatchedState(item, watched)`
  / `applyResumeState(item, positionSeconds)` (duration from `RunTimeTicks`), plus
  `useWatchStateRefresh(refresh)`: subscribes, **debounces 300ms**, single-flight with a
  queued follow-up.
- Emitters: card menu watched toggle (optimistic set + publish after server success, rollback
  on failure), player exit (resume position), player natural end (watched), series-page
  single-episode mark (updates rail in place + publishes).
- Consumers: every `MediaCard` subscribes by id (in-place checkmark/progress/title update);
  Home, For You and Library-recommendations rails refresh (debounced) on any event; Continue
  Watching rows also filter out `Played` items in a bus-driven render pass (Android
  `LocalUserStateOverlay` behaviour) so the row updates instantly regardless of refetch
  timing; refetches reconcile on top (server decides what surfaces next — Plex-like).
- Refresh must always apply (a `mountedRef` guard silently skipped updates once — no guards
  on apply). Landing `focusFirstContentCard` keys on `[loading]` only so refreshes never yank
  focus.
- Server realtime (verified by raw socket probe): `POST /api/v2/events/ws-ticket` →
  `{ticket, expires_in:30, max_connection_seconds:300, protocol:"silo.events.v2"}`;
  WSS `/api/v2/events/ws?channels=user_state,catalog` with
  `Sec-WebSocket-Protocol: silo.events.v2, silo.ticket.<ticket>`; expect `hello`, then
  `subscribed`; events: `user_state.changed {profile_id, content_id, change:"watched", played}`
  (drop foreign profiles), catalog events → Recently Added. Client: 2s debounce coalescing,
  reconnect backoff 1→30s, honor `max_connection_seconds`, 20s visible-gated poll fallback.
- Dev proxy needs `ws: true` + Origin rewrite to the configured server origin (server resets
  sockets with foreign Origin).

## Detail screens (movie / person) — rebuild from Android screens

- Movie: facts table (from `TvDetailMetadata`), Cast & Crew row, Trailers & More row
  (YouTube via `platform/youtube.ts` — webOS-safe embed), Related rail (Android poster style),
  "Directed by …" credit line above the action row (movie only).
- Person page (`PersonScreen.tsx`): photo, birth/death dates, birthplace, expandable bio,
  paged filmography grid via `/catalog?source=person&person_id=`; person lookup by name when
  a cast entry lacks an id; Back returns to the title with focus on the cast card.
- Cast/trailer rows: portal their menus (if any) — `.home-rails` has `isolation: isolate`,
  fixed scrims inside it get painted under the hero; render through a React portal to body.

## Browse / library (survives, but re-check these during rebuild)

- Multi-library merge: keep rendered prefix, append later pages in library order, NEVER
  re-sort rendered items (AGENTS.md rule); error → do not abort paging.
- First-card landing focus with retry (~2s budget, cancels on keypress or existing focus);
  `LibraryScreen` must be keyed by section+landing+library ids (remount on switch) — a reused
  instance skipped the focus effect and broke Movies↔TV landing.
- Empty-library probe: unfiltered library check to distinguish "empty" vs "no match".

## Still-open parity items (from earlier planning, not yet built when lost)

- "Go to Season" / "Go to Series" for standalone season/episode pages.
- Spoiler protection for unwatched episodes; theme music; Watch Party; AI translation.
- Music Genres (explicitly deferred by user).
- Dismissal rows on Home cards ("Remove from Continue Watching / Next Up", Android
  `HomeDismissal.kt`).
- BranDing: Silo name/logo are trademarked separately; dev working name is fine, store
  publishing needs permission.

## Rebuild order (proposed)

1. `icons.tsx` + `watchState.ts` + card context menu (exact source from chat) → wire MediaCard.
2. `spatial.ts`: modal trap → row locks → season/episode/button ladders → first-focus retry.
3. Series screen: wrapper structure, icon-collapse action row, metadata row, summary
   placement, More menu rows, mark-watched in place.
4. `silo.ts` API + DetailSections: cast, trailers, similar, facts, person page.
5. PlaybackOptions dialog + prefs endpoints + editions grouping.
6. `events.ts` socket + rail refresh wiring + Home dismissal rows.
7. AudiobookGroups + Person screens; music genres if revisited.

## Recovery outcome (Oct 29)

The 19:31:04 pre-wipe snapshot (a full `git add` of the working tree ~10 minutes before the 19:41 overwrite) was found as dangling blobs via `git fsck --lost-found` and restored file by file: App, api (silo, playback, events), components (TopNav, DetailSections, PlaybackOptions, FeaturedRailsScreen, MediaCard, MediaRail), core/watchState, navigation/spatial, platform/youtube, screens (Details, Series, Person, AudiobookGroups, LibraryCollections, Library, LibraryBrowsePanels, Home, ForYou, LibraryRecommendations, Player), types, styles.css, vite.config.ts, index.html, README and roadmap. Files with no 19:31 blob were unchanged from what is committed. Re-applied on top: LG Back `10009` + player-owned Back guard in App.tsx. Changes made between 19:31 and 19:41 are not recoverable; the rebuild steps above now apply only to anything found missing during device testing.
