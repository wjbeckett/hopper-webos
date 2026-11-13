# Performance on a TV

How Hopper's speed is measured on a real LG TV, what the measurements found, and the rules that came out of them. Read this before changing how Home renders or how the player starts.

All numbers are from one TV: LG, webOS 22 (Chrome 87), 4 cores, 1 GB reported device memory, 1920x1080 render resolution. A desktop browser cannot stand in for it. Slowing a desktop CPU 150 times did not reproduce the TV's behaviour, because Chrome 89 and later composite things that Chrome 87 paints on the main thread.

## How to measure

The TV's browser has a Chrome DevTools inspector on port 9998 while Developer Mode is on. The scripts in `scripts/tvbench/` drive the app through it. They need Node 22, or Node 20.10+ with `--experimental-websocket`.

```sh
export TV_HOST=<the TV's address> WEBOS_DEVICE=<name from ares-setup-device>
node scripts/tvbench/home.mjs      # Home navigation: frames, long tasks and main-thread time per key press
node scripts/tvbench/layers.mjs    # compositor layers on the current screen, with the reason for each
ROW=1 node scripts/tvbench/play.mjs  # Play to first frame, with video events and network requests
```

- `home.mjs` cold-launches the app, then traces Right x6, Left x6, Down x4 and Up x4, twice. Compare the same pass before and after a change.
- `play.mjs` really plays the title for a few seconds, so it moves that title's resume position.
- For a profile by function name, build with `npx vite build --minify false` before packaging.

The scripts were rewritten for the repository from the ones used for the numbers below and have not been run on a TV in this form.

## Home navigation

Measured per key press, in the 700 ms after it, straight after a cold launch with the CPU profiler on (first table) and with a trace on (second).

| | Before | After |
| --- | --- | --- |
| Right: main-thread frames (of 42) | 9 | 40 |
| Right: long tasks | 371 ms | 0 ms |
| Right: time to first frame | 90 ms | 38 ms |
| Down: main-thread frames | 5 | 30 |
| Down: long tasks | 598 ms | 57 ms |
| Up: main-thread frames | 5 | 38 |
| Up: long tasks | 472 ms | 17 ms |

| | Before | After |
| --- | --- | --- |
| Cards mounted on Home | 210 | 52 |
| Elements on Home | 1647 | 692 |
| Compositor layers | 120 | 23 |
| Main-thread time per Right press | 780 ms | 250 ms |
| Main-thread time per Down press | 830 ms | 430 ms |

What the trace showed, and what was done about each:

1. **Every card on Home was mounted.** Ten rows of twenty cards meant 210 cards, each several paint layers deep. Chrome's compositing update, which runs on every focus change, costs time for every one of them (about 250 ms per key press). Now only rows near focus render cards, and each row renders the cards around the focused one. Other positions are empty placeholders of the same size, so nothing shifts.
2. **A focus change re-rendered every row.** The hero's state lived in the screen component. It is now its own component, driven through a ref, and rows and cards are memoised. JavaScript per key press went from about 200 ms to about 50 ms.
3. **Rows and the band were scrolled from script,** one `scrollLeft` or `scrollTop` write per frame. Each write cost a compositing update and a commit, and Chrome flipped between composited and main-thread scrolling depending on what had animated last. In the composited state every z-indexed child of a card got its own layer. Now nothing scrolls: the row's strip and the band's inner block are moved with a `transform` that a CSS transition animates. One style change per key press.
4. **The backdrop was rebuilt on every focus change.** A new `<img>` with a CSS mask meant new layers and a full-screen repaint each time. On a TV it is now two images that stay mounted and trade places with an opacity change, under one fixed shade that draws the soft edges.
5. **Transitions inside cards** promoted each element to a layer for their length. Making and dropping those layers cost more than the frames they drew. Focus scale and artwork reveal are instant on a TV.
6. **Every Back refetched Home** behind a loading screen and put focus on the first card. Home's rows are now kept in memory, shown at once, refreshed in the background, and focus returns to the card it was on.

## Blur placeholders

Measured on the LG 50UQ9000PSD (webOS 22) with 140 ThumbHashes from a real server, run in the app's page:

| Decoder | Per hash |
| --- | --- |
| Reference algorithm, 32 px, canvas and PNG | 6.6 ms (decode 3.7, canvas 1.1, PNG 1.4) |
| Cosines once per row and column, 16 px, BMP written by hand (`src/core/artwork.ts`) | about 2 ms while the code is new to the JIT, 0.6 ms after |

A season of 130 episodes decodes in well under 150 ms once, and results are cached.

## Playback start

Time from the OK press on Play to the first frame, three plays each. The first play after a cold launch is about 2 s slower than the rest, because the player's code is loaded then.

| | Before | After |
| --- | --- | --- |
| Film from the start (H.264, AAC) | 3.0 to 5.8 s | 1.4 to 1.5 s (3.3 s first play) |
| Resumed episode (HEVC, audio converted to AAC) | 4.4 to 7.0 s | 2.0 to 2.5 s (3.5 s first play) |
| Resumed episode (HEVC, E-AC-3 passed through) | did not play | 2.2 to 2.4 s (4.5 s first play) |

Measure this with the video element's events only. Turning on the inspector's Network domain, a trace or the profiler slows segment loading on the TV enough to add seconds, and the first numbers taken that way were wrong.

Findings:

1. **A seek costs seconds.** The TV rebuilds its media pipeline on every seek. The playlist carries `EXT-X-START:TIME-OFFSET=0.001`, hls.js seeked to it, and that one-millisecond seek was most of the start time. hls.js is now given its start position outright. With the seek swallowed in a test, the same film went from 3.0–5.8 s to 1.4–1.6 s.
2. **Resumes seeked too.** A stream starts on the keyframe before the requested position, up to about ten seconds earlier, and the player seeked across that gap. Opening or resuming a title now plays through gaps up to 10 s, so it starts that much earlier and does not seek. Seeks and track changes made by the viewer keep a 3 s limit.
3. **The playlist was 1.3 MB.** Silo signs every segment URL with the same 900-character token. hls.js parses playlists on the main thread, which took 0.7 to 1.8 s on the TV, during start-up. The token is now stripped from the text before hls.js sees it and put back on each request (`src/core/hlsPlaylistToken.ts`).
4. **Dolby audio did not play at all.** The TV accepts AC-3 and E-AC-3 in an audio-only MediaSource buffer but refuses them in a buffer shared with video, which is how Silo's HLS segments arrive: playback failed with `bufferAddCodecError`. The page now gets a stand-in buffer that splits each segment into a video buffer and an audio buffer (`src/platform/splitSourceBuffer.ts`, `fmp4Split.ts`). The audio is copied, not converted, so the TV receives the original Dolby stream. Confirmed on the TV for E-AC-3 with H.264 and with HEVC, and for AC-3 5.1 with H.264: plays, skips, pauses and replays, and one episode ran for ten minutes. Not confirmed by ear.
5. **The player fetched all of Home when an episode started,** a dozen requests, to fill its On Deck row. It now uses the rows Home already holds.
6. **Dolby streams seeked at the start.** Audio that is copied does not begin on the same instant as the video, so the buffer starts 0.01 to 0.2 s after 0. hls.js waited one 100 ms poll for playback to begin and then seeked over the gap. The TV starts across the gap by itself, so hls.js now gives it 2 s first (`src/platform/startGap.ts`). Resumed E-AC-3 episodes, from Play to the `playing` event: H.264 went from 1.9–3.1 s to 1.6–1.7 s, HEVC from 2.1–2.5 s to 1.3–1.5 s. The first Dolby play after the TV was switched on took 10.5 s, 8.5 s of it in that seek; that case has not been timed without the seek.

Left over:

- Resumes whose keyframe gap is over 10 s still seek.
- The first play after launch pays for loading hls.js. It could be loaded while Details is on screen.

## Slow connections (#63)

LG tests playback at 512 kbps, 1 Mbps, 7 Mbps and 17.5 Mbps. Measured on the LG 50UQ9000PSD (webOS 22) with the inspector's network throttling (30 ms latency), on a 1080p HEVC film whose source is 1.7 Mbps. The server offers it as one stream, so hls.js has no lower level to switch to: only a replan lowers it.

| Speed | Before | After (buffering quality) |
| --- | --- | --- |
| 512 kbps | first picture 19.5 s at 1080p; stalled every few seconds, then the stream was restarted, still 1080p | lowered at 20 s, before the first picture; first picture 27 s at 480p (695 kbps); lowered again at 38 s to 276 kbps; then real time, 30 s buffered |
| 1 Mbps | first picture 13.3 s at 1080p; 56 s played in 77 s, under 6 s buffered | first picture 13.8 s at 1080p; lowered at 22 s to 480p (695 kbps); then real time, 16 s buffered |
| 7 Mbps | not measured | first picture 3.9 s at 1080p, 30 s buffered, no lowering |
| 17.5 Mbps | not measured | first picture 2.1 s at 1080p, 30 s buffered, no lowering |
| Unthrottled | first picture 4.2 s at 1080p | unchanged |

Two things the TV does differently from Android's Media3:

- **webOS does not always report a stall.** At 512 kbps after the first lowering, playback crawled at 0.6× speed with under a second buffered and fired no `waiting` event, so nothing lowered again. The player now also watches the playhead (`src/screens/playerBufferingQuality.ts`).
- **The first segment is slow to measure.** At 512 kbps a 10 s 1080p segment takes over 30 s, longer than the stall timer, and a lowering before the first picture needs a measured throughput. Bytes are now counted as they arrive, from the segment requests' progress events. That brought the first picture at 512 kbps from 53 s to 27 s.

**Starting at the right quality.** As Android does, the app runs a speed test in the background 5 s after launch (not while a title plays, nor within a minute of a start, and not when the server turned automatic tests off), keeps the reading per server for the server's `bandwidth_probe_max_age_seconds` or a week, and sends it with every playback start (`src/core/bandwidthProbe.ts`). On the maintainer's network it measured 65.9 Mbps. With a reading of 500 kbps and the link at 512 kbps, the first picture came at 7.8 s at 480p with no lowering needed, against 27 s with a lowering when there is no reading.

## Browse grids

Holding Down for 3 s with key repeats every 80 ms, on webOS 22. "Off screen" counts samples, taken every 250 ms, where the focused card was outside the screen.

| Grid | Before | After (#83) |
| --- | --- | --- |
| Continue Watching → Explore all | off screen in 6 of 7 samples; frames median 17 ms, 90th percentile 83 ms, worst 317 ms, 15 of 126 over 50 ms | off screen 0 of 12; median 17, 90th percentile 100, worst 217, 18 of 89 over 50 ms |
| Library Browse | not measured | off screen 0 of 10; median 67, 90th percentile 117, worst 383, 30 of 53 over 50 ms |

The fix was to stop starting a native smooth scroll on every press: grids now jump while a key is held. The selector stays on screen, but the frames did not get faster. A CPU profile of the held key in Browse showed no long tasks and a mostly idle main thread, so the cost is in painting and rasterising the newly exposed rows, not in script. Translating the grid instead of scrolling it, as Home does with its rows, is the next thing to try.

## Rules that came out of this

- Keep the number of mounted cards small. Do not render what is far off screen.
- Move things with `transform` and `opacity` on elements that already have their own layer. Do not animate scroll positions from script.
- Do not create or destroy composited layers when focus moves: no transitions inside cards, no remounting images, no CSS masks on things that fade.
- Keep focus-driven state out of components that render lists.
- Never seek the video unless the viewer asked to. On a TV even a one-millisecond seek costs seconds.
- Measure on the TV before and after. Changes chosen by eye have gone both ways. Measure with the lightest tool that answers the question: tracing and the Network domain change the result.
