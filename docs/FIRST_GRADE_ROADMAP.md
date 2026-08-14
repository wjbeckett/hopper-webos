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
- Movies / TV / Music / Audiobooks library surfaces
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
- LG Back key handling (`461`)
- CachyOS build/package/install/debug helpers

### Release blockers
1. Validate the implemented Silo protocol-v3 planner/replan contract against a live server and official client behavior.
2. Token refresh with the exact Silo refresh endpoint and single-flight retry.
3. Validate the Silo-native catalog endpoints and response models against the live server.
4. Household profile picker/PIN flow.
5. Validate playback progress/stop reporting and watched-state thresholds against the live server.
6. Subtitle styling plus intro/credits controls; validate the implemented audio/subtitle picker and chapters.
7. Validate codec/container matrix on at least one older and one current LG webOS generation.
8. Network-loss/reconnect UX and expired-session recovery.
9. Automated tests for navigation geometry, auth state, API parsing and player state.
10. Store assets, accessibility pass, privacy copy, trademark approval and LG certification checklist.

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
