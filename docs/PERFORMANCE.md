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
4. **Dolby audio did not play at all.** The TV accepts AC-3 and E-AC-3 in an audio-only MediaSource buffer but refuses them in a buffer shared with video, which is how Silo's HLS segments arrive: playback failed with `bufferAddCodecError`. The page now gets a stand-in buffer that splits each segment into a video buffer and an audio buffer (`src/platform/splitSourceBuffer.ts`, `fmp4Split.ts`). The audio is copied, not converted, so the TV receives the original Dolby stream. Confirmed on the TV for HEVC with E-AC-3 5.1: plays, skips, pauses and replays. Not confirmed by ear, and AC-3 has not been tried.
5. **The player fetched all of Home when an episode started,** a dozen requests, to fill its On Deck row. It now uses the rows Home already holds.

Left over:

- With split Dolby audio, HEVC video starts 0.2 s after the audio, so there is a 0.2 s hole at the start and hls.js seeks over it. That seek is inside the 2.2 to 2.4 s above. Shifting the timeline would remove it.
- Resumes whose keyframe gap is over 10 s still seek.
- The first play after launch pays for loading hls.js. It could be loaded while Details is on screen.

## Rules that came out of this

- Keep the number of mounted cards small. Do not render what is far off screen.
- Move things with `transform` and `opacity` on elements that already have their own layer. Do not animate scroll positions from script.
- Do not create or destroy composited layers when focus moves: no transitions inside cards, no remounting images, no CSS masks on things that fade.
- Keep focus-driven state out of components that render lists.
- Never seek the video unless the viewer asked to. On a TV even a one-millisecond seek costs seconds.
- Measure on the TV before and after. Changes chosen by eye have gone both ways. Measure with the lightest tool that answers the question: tracing and the Network domain change the result.
