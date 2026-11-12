# Decisions

What Hopper deliberately does differently from the official Android TV app, and what it does not plan to build. This file holds decisions only. Work to do lives in [GitHub issues](https://github.com/wjbeckett/hopper-webos/issues), grouped by milestone.

Hopper is its own client. The Android TV app (`silo-android/androidTvApp/`) is the reference to read first for behaviour, layout and server contracts. It is a reference, not a checklist.

## Where Hopper differs

Deliberate differences from the Android TV app. Do not "fix" these to match Android without the maintainer's say-so. Add a line here whenever a new difference is decided.

- Diagnostics stay on the device. Hopper never uploads logs or reports to the hosted diagnostics collector, because the Silo maintainer does not accept reports from third-party clients. Logs can be viewed and exported locally.
- Hopper has its own name, mark, colours and startup animation. No Silo logo assets ship in the app.
- Watch Party is not built. Gate inspected on 2026-11-10: Android puts it behind a device-local Settings → Experimental → Watch Party toggle (`WatchPartyExperiment`, preference `silo_experimental`/`watch_party`) that defaults on in debug builds and off in release builds; turning it off hides every entry point. It is an opt-in experiment, not a shipped Android TV destination, so Hopper does not implement it and must not imply it is available. If product scope later requires it, implement the complete room lifecycle, realtime sync and player coordination, not just its hub screen.
- Sign-in, first-run setup and invite sign-up use Hopper's centred card layout, not Android's marquee layout with the "use your phone" card.
- Back on first-run setup (a server with no accounts yet) opens the TV's exit popup, as code sign-in does. Android returns to server setup; in Hopper, server setup's Back reopens the saved server, which would show first-run setup again.
- Invite sign-up availability is probed when the password sign-in screen opens. Android probes it when the server is chosen.
- Text entry uses the webOS system keyboard on the focused field. Android's on-screen keyboard dialog is not ported.
- Details, Series pages and the Home hero show a time-left ring for partly watched titles, in the brand teal. No equivalent was found in the Android TV source.
- Playback is always negotiated as HLS. Original-file and progressive delivery are switched off in the device profile, because the LG browser can report codec support and still reject the container.
- On a TV, the focus ring and scale on a card and the reveal of its artwork are instant, where Android animates them. Each animation made a compositor layer per card on every focus change, which cost more than it drew (`docs/PERFORMANCE.md`).
- Dolby audio (AC-3, E-AC-3) reaches the TV through a second MediaSource buffer. webOS 22's browser refuses it in a buffer shared with video, so Hopper splits Silo's combined segments into video and audio itself (`src/platform/splitSourceBuffer.ts`). Android plays the combined stream directly.
- Opening or resuming a title may start up to 10 s before the saved position, at the previous keyframe, because seeking to the exact position costs several seconds on a TV.
- When the server cannot be reached while browsing, Hopper shows a dialog with "Try again" and "Dismiss", then a small notice, and loads the screen again when the server answers. Android shows an "Offline mode - select to retry" pill and keeps a cached Home; Hopper has no offline mode beyond the Home rows it already caches.
- The Magic Remote pointer is supported, because LG requires it: pointing at a control focuses it, and rows of cards get arrows at their edges while the pointer is over them. Android TV has no pointer.
- The access token is kept in memory only and renewed from the refresh token on every launch, which adds one request before the first screen loads. Android stores it, encrypted. The refresh and profile tokens are encrypted on the TV in both clients.
- Audio delay is 0 to 1000 ms. Android allows -1000 to 1000 ms; a WebAudio `DelayNode` cannot move audio earlier. Keep the limit unless a TV-safe way to advance audio is shown not to make sync worse.
- The TV cannot browse the network for servers, because a web app has no mDNS. Phone pairing covers discovery (the phone finds the TV); manual entry and saved servers remain.
- Episode items open within the Series screen, which selects the relevant season; standalone episode/season pages are not webOS destinations.

## Not planned

- Ebook reading and phone-style downloads management are not exposed on TV unless product direction changes. Android TV hides ebook-like content too.
- Global Browse (`TvBrowseScreen`): Android registers `TvMainRoute.Browse`, but its only opener is Home's `onSeeAll`, which `TvHomeContent` never wires to a control, so no Android TV entry point reaches it. webOS ships no screen for it; `getBrowseCatalogPage`/`getBrowseFilterOptions` in `src/api/silo.ts` are ready if Android adds an entry point.
- Android TV has no navigation route to `TvInboxScreen`, so there is no Android TV inbox destination to reproduce.
