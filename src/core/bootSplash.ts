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
/** If the page has not been reported visible this long after the app starts, start the animation anyway. */
const START_FALLBACK_MS = 4000;
/** Safety net: never hold the app behind the splash longer than this after the app starts. */
const MAX_WAIT_MS = 12000;

/** After the animation, wait up to this long for the artwork on screen to load before lifting. */
const CONTENT_WAIT_MS = 1500;

/** True when the app has rendered images and every one inside the viewport has loaded. */
function contentReady(): boolean {
  const images = document.querySelectorAll<HTMLImageElement>("#root img");
  if (!images.length) return false;
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    if (image.complete) continue;
    const box = image.getBoundingClientRect();
    if (box.width > 0 && box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth) return false;
  }
  return true;
}

type SplashWindow = Window & { __bootSplashStart?: number; __bootSplashPlay?: () => void; __bootSplashLog?: Array<[string, number]> };

/**
 * @param play false on a launch with no saved session: the splash is dropped at once and the
 *   sign-in or pairing screen shows, as before.
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
    // For checking a launch on a TV (the inspector console, or Settings > Diagnostics with
    // debug logging on): the launch timeline in ms since navigation.
    const timeline = (window as SplashWindow).__bootSplashLog ?? [];
    timeline.push(["app-start", Math.round(appStartedAt)], ["lift", Math.round(performance.now())]);
    console.info("[Hopper] startup splash", timeline.map(([name, at]) => `${name}@${at}`).join(" "));
    splash.classList.add("leaving");
    window.setTimeout(() => {
      splash.remove();
      window.removeEventListener("keydown", swallow, true);
      window.removeEventListener("keyup", swallow, true);
    }, FADE_MS);
  };
  // The animation is over. Hold the splash a little longer if the screen underneath is still
  // loading its artwork, so lifting it reveals a finished screen and not empty cards.
  const waitForContent = () => {
    const deadline = performance.now() + CONTENT_WAIT_MS;
    const check = () => {
      if (done) return;
      if (contentReady() || performance.now() >= deadline) finish();
      else playedTimer = window.setTimeout(check, 100);
    };
    check();
  };
  const onStart = () => {
    const startedAt = (window as SplashWindow).__bootSplashStart;
    if (startedAt == null || done) return;
    window.clearTimeout(playedTimer);
    playedTimer = window.setTimeout(waitForContent, Math.max(0, startedAt + ANIMATION_MS - performance.now()));
  };
  const startFallback = window.setTimeout(() => (window as SplashWindow).__bootSplashPlay?.(), START_FALLBACK_MS);
  const cap = window.setTimeout(finish, MAX_WAIT_MS);
  window.addEventListener("boot-splash-start", onStart);
  onStart();
}

/** How long the app waits for the splash animation to start before rendering anyway. */
const RENDER_WAIT_MS = 1500;

/**
 * Runs `callback` once the splash animation has started (or at once when there is no splash).
 * The first render of the app blocks the main thread for a second or more on a TV. Starting
 * the animation needs one free main-thread frame, so the app's first render waits for it;
 * after that the compositor keeps the animation moving on its own.
 */
export function afterBootSplashStarts(callback: () => void) {
  const splash = document.getElementById("boot-splash");
  if (!splash || (window as SplashWindow).__bootSplashStart != null) {
    callback();
    return;
  }
  let called = false;
  const run = () => {
    if (called) return;
    called = true;
    window.clearTimeout(timer);
    window.removeEventListener("boot-splash-start", run);
    callback();
  };
  const timer = window.setTimeout(run, RENDER_WAIT_MS);
  window.addEventListener("boot-splash-start", run);
}
