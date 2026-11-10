/**
 * Controller for the startup splash in index.html (#boot-splash).
 *
 * The splash and its animation are plain HTML and CSS so they are on screen from the first
 * paint. This module only decides when to lift it: once the animation has played in full,
 * counted from the frame it actually started on (index.html sets `__bootSplashStart` and
 * fires "boot-splash-start"), not from when the app mounted. The app renders underneath
 * meanwhile, so lifting the splash reveals a loaded screen. Remote keys are swallowed while
 * it is up. It plays on launches with a saved session only.
 */

/** Length of the animation plus a short hold on the finished mark (timeline in index.html). */
const ANIMATION_MS = 2600;
const FADE_MS = 400;
/** If the page's load event has not started the animation this long after the app starts, start it anyway. */
const START_FALLBACK_MS = 4000;
/** Safety net: never hold the app behind the splash longer than this after the app starts. */
const MAX_WAIT_MS = 12000;

type SplashWindow = Window & { __bootSplashStart?: number; __bootSplashPlay?: () => void };

/**
 * @param play false on a launch with no saved session: the splash is dropped at once and the
 *   sign-in or pairing screen shows, as before. The animation has not started by then, because
 *   index.html starts it on the load event, which comes after this module has run.
 */
export function releaseBootSplashWhenDone(play: boolean) {
  const splash = document.getElementById("boot-splash");
  if (!splash) return;
  if (!play) {
    splash.remove();
    return;
  }

  const swallow = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener("keydown", swallow, true);
  window.addEventListener("keyup", swallow, true);

  const appStartedAt = performance.now();
  let done = false;
  let playedTimer: number | undefined;
  const finish = () => {
    if (done) return;
    done = true;
    window.clearTimeout(playedTimer);
    window.clearTimeout(startFallback);
    window.clearTimeout(cap);
    window.removeEventListener("boot-splash-start", onStart);
    // For checking a launch on a TV (Settings > Diagnostics, or the inspector): when the app
    // started, when the animation started, and when the splash lifted, in ms since navigation.
    const startedAt = (window as SplashWindow).__bootSplashStart;
    console.info("[Hopper] startup splash", {
      appStartedMs: Math.round(appStartedAt),
      animationStartedMs: startedAt == null ? null : Math.round(startedAt),
      liftedMs: Math.round(performance.now())
    });
    splash.classList.add("leaving");
    window.setTimeout(() => {
      splash.remove();
      window.removeEventListener("keydown", swallow, true);
      window.removeEventListener("keyup", swallow, true);
    }, FADE_MS);
  };
  const onStart = () => {
    const startedAt = (window as SplashWindow).__bootSplashStart;
    if (startedAt == null || done) return;
    window.clearTimeout(playedTimer);
    playedTimer = window.setTimeout(finish, Math.max(0, startedAt + ANIMATION_MS - performance.now()));
  };
  const startFallback = window.setTimeout(() => (window as SplashWindow).__bootSplashPlay?.(), START_FALLBACK_MS);
  const cap = window.setTimeout(finish, MAX_WAIT_MS);
  window.addEventListener("boot-splash-start", onStart);
  onStart();
}
