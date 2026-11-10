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

Measured once for one episode (H.264 video, E-AC-3 audio, resumed mid-way), after the fixes below:

| Step | ms after the press |
| --- | --- |
| Player on screen | 193 |
| `playback/start` answered | 411 |
| Playlist loaded | 664 |
| First segment loaded | 1110 |
| Video metadata | 1441 |
| First frame | 6462 |

Findings:

1. **Dolby audio did not play at all.** The TV accepts AC-3 and E-AC-3 in an audio-only buffer but refuses them in a buffer shared with video, which is how Silo's HLS segments arrive. Hopper claimed both codecs, Silo sent the audio untouched, and playback failed with `bufferAddCodecError`. Hopper now tests each audio codec alongside video before claiming it, so Silo converts Dolby audio to AAC. Confirmed on the TV: the same episode plays.
2. **The player fetched all of Home when an episode started,** a dozen requests, to fill its On Deck row. It now uses the rows Home already holds.
3. **Five seconds between metadata and the first frame,** with six seconds already buffered. The player seeked 1.9 s into the stream at that point. The player now plays through start offsets under 3 s and does not seek. This change has not been measured: the TV went offline first.
4. **Not addressed:** the stream's playlist is refetched every 2 s and grows (300 kB within 11 s), and there was one 1 s long task about 2 s after the press whose cause is unknown.

## Rules that came out of this

- Keep the number of mounted cards small. Do not render what is far off screen.
- Move things with `transform` and `opacity` on elements that already have their own layer. Do not animate scroll positions from script.
- Do not create or destroy composited layers when focus moves: no transitions inside cards, no remounting images, no CSS masks on things that fade.
- Keep focus-driven state out of components that render lists.
- Measure on the TV with a trace before and after. Changes chosen by eye have gone both ways.
