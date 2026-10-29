# First-grade client roadmap

## Shipping bar

This client should feel like a native TV product, not a browser page packaged as an IPK.

### Implemented foundation
- TV-first top navigation
- D-pad spatial focus system
- QR/device sign-in as primary authentication
- password fallback
- multi-server registry
- profile token context preservation
- Continue Watching and content rails
- Home, For You, and library Recommended screens use a shared focused-item marquee above a fixed-height, internally scrollable row band; horizontal focus changes crossfade, vertical row changes roll in the navigation direction, and logos/artwork load over color gradients
- Home/Recommended artwork is upper-right anchored and fades into a blurred color wash; the backdrop shifts with rail scrolling and receives an Android-style sampled diagonal tint when the artwork server permits safe canvas sampling
- Movies / TV / Music / Audiobooks library surfaces
- Android TV-style Library Browse sort and facet panels, including server-backed catalog facets, audiobook/video-specific sort choices, large-facet search, clear/reset, and layered remote focus/back behavior. The title-sorted Browse view also has a collapsed-dot A–Z rail; like Android TV, choosing a letter reloads the grid with the server `name_prefix` filter (`All` clears it; applying filters resets it). Sort, filters and match mode persist per server/profile/library (and media-type scope) behind a "Preserve sort & filters" toggle in the filter panel, as on Android TV. Browse cards match Android (title plus year only, white check watched badge, no progress bar, square art for audiobooks), the empty states use Android's wording, and a failed first page shows Retry and Clear filters. Not yet matched: Android's empty-library probe, and shuffle via the server launcher (webOS picks a random loaded item). Browse is a continuous list with no load-more footer; opening a title records it, and returning restores sort/filters and re-focuses that card (loading up to four further pages to find it, otherwise focusing the first card). Authenticated runtime and physical-TV validation remain open under blockers 3 and 9.
- Calendar week and Following / Trending / All filters
- Collections and watch-history browsing
- Requests discovery, search, request/cancel, and follow workflows
- household profile switching with PIN verification
- debounced global search
- series -> seasons -> episodes
- resume progress indicators
- TV capability probe using HTMLMediaElement `canPlayType`
- dedicated fullscreen player chrome
- Silo protocol-v3 playback start and replan negotiation
- playback progress/stop lifecycle reporting
- HLS execution with negotiated request headers
- audio, subtitle, and quality selection through replanning
- chapter markers and source-timeline seeking
- LG Back key handling (`461`/`10009`), including callout dismissal, detail return, and root-section return to Home; the player owns Back while mounted (panel closes first, then exit back to the originating screen) and the full remote grammar works there: OK play/pause, ±10 s arrow seek, media keys (Play/Pause/PlayPause/Stop/FF/Rewind), D-pad focus across Back/Audio/Subtitles/Quality/timeline, and panel-scoped Up/Down row navigation that cannot jump focus out of the panel
- CachyOS build/package/install/debug helpers

### Release blockers
1. Validate the implemented Silo protocol-v3 planner/replan contract against a live server and official client behavior.
2. Token refresh with the exact Silo refresh endpoint and single-flight retry.
3. Validate the Silo-native catalog endpoints and response models against the live server.
4. Household profile creation/editing and full profile-management parity.
5. Validate playback progress/stop reporting and watched-state thresholds against the live server.
6. Subtitle styling plus intro/credits controls; validate the implemented audio/subtitle picker and chapters.
7. Validate codec/container matrix on at least one older and one current LG webOS generation.
8. Network-loss/reconnect UX and expired-session recovery.
9. Automated tests for navigation geometry, auth state, API parsing and player state.
10. Store assets, accessibility pass, privacy copy, trademark approval and LG certification checklist.
11. Side-by-side Android TV parity verification remains open. The client still lacks the Android inbox/notifications and person-detail flows; its detail screen omits cast/crew, trailers, facts, and version sections; audiobook detail/playback uses the generic video flow; and Back does not consistently return to the originating screen. Home metadata enrichment and LG-remote focus transitions also need verification. The sampled Home ambient tint is implemented, but artwork CORS behavior and physical-TV rendering still need validation; parity must not be claimed until the remaining gaps and device behavior are checked.

### Product parity targets
Follow the official Silo TV clients:
- Home
- media-type tabs
- Calendar
- Search
- profile/settings
- Continue Watching
- Recently Added/Released
- curated recommendations
- browsing/filtering/sorting
- movie + series detail
- seasons/episodes
- multi-version files
- adaptive Direct Play/Remux/Transcode
- track/subtitle switching
- favorites/watchlist
- household profiles
- multi-server accounts
- Requests where server-enabled
- audiobook TV flow
- SiloControl receiver compatibility

Do not expose ebook reading or phone-style downloads management on TV unless product direction changes.
