import { useEffect, useRef, useState } from "react";
import { HOPPER_ACCENT, HOPPER_BODY_PATH, HOPPER_INK, HOPPER_PLAY_PATH } from "./HopperMark";

/** Safety net: never hold the app behind the splash longer than this. */
const MAX_SPLASH_MS = 6000;
const FADE_MS = 400;
/** Length of the brand animation (see `.startup-splash` keyframes in styles.css). */
const ANIMATION_MS = 2200;

/**
 * Cold-launch splash. It covers the real app, which keeps rendering underneath, so Home
 * fetches and settles while the Hopper mark animates. Lifting it reveals a finished screen.
 * Remote keys are swallowed while it is up. Pure CSS transforms/opacity: no video decode.
 */
export function StartupSplash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    const swallow = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", swallow, true);
    window.addEventListener("keyup", swallow, true);
    const cap = window.setTimeout(finish, MAX_SPLASH_MS);
    const done = window.setTimeout(finish, ANIMATION_MS);
    return () => {
      window.removeEventListener("keydown", swallow, true);
      window.removeEventListener("keyup", swallow, true);
      window.clearTimeout(cap);
      window.clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    window.setTimeout(onDone, FADE_MS);
  }

  return (
    <div className={`startup-splash ${leaving ? "leaving" : ""}`} aria-hidden="true">
      <div className="startup-splash-brand">
        <svg className="startup-splash-mark" viewBox="0 0 100 100" focusable="false">
          <path className="startup-splash-body" d={HOPPER_BODY_PATH} fill={HOPPER_ACCENT} />
          <path
            className="startup-splash-play"
            d={HOPPER_PLAY_PATH}
            fill={HOPPER_INK}
            stroke={HOPPER_INK}
            strokeWidth="3"
            strokeLinejoin="round"
          />
        </svg>
        <span className="startup-splash-word">Hopper</span>
      </div>
    </div>
  );
}
