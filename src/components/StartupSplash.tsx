import { useEffect, useRef, useState } from "react";

/** Safety net: never hold the app behind the splash longer than this. */
const MAX_SPLASH_MS = 6000;
const FADE_MS = 400;

/**
 * Cold-launch splash (Android TV parity). It covers the real app, which keeps rendering
 * underneath, so Home fetches and settles while the video plays. Lifting it reveals a
 * finished screen. Remote keys are swallowed while it is up.
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
    return () => {
      window.removeEventListener("keydown", swallow, true);
      window.removeEventListener("keyup", swallow, true);
      window.clearTimeout(cap);
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
      <video
        src="./startup-splash.mp4"
        autoPlay
        muted
        playsInline
        onEnded={finish}
        onError={finish}
      />
    </div>
  );
}
