import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const BACK_KEYS = ["Escape", "Backspace", "Back", "GoBack", "BrowserBack"];
/** How far one Up or Down press moves the full text (Android TV's popup uses the same step). */
const SCROLL_STEP = 180;

/**
 * An overview cut to a fixed number of lines, so the controls under it never move. It is a
 * focus stop above the buttons; OK opens the whole text in a popup that Up and Down scroll and
 * OK or Back closes (Android TV: TvExpandableSynopsis).
 *
 * `preview` is what the hero shows (it can carry the episode's name in front); `text` is the
 * clean overview the popup shows under `title`.
 */
export function ExpandableOverview({ className, preview, text, title }: {
  className: string;
  preview?: string;
  text: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // A different title or episode under an open popup closes it, with focus back on the overview.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) close(); }, [text, title]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }));
    const onKey = (event: KeyboardEvent) => {
      const back = BACK_KEYS.includes(event.key) || event.keyCode === 461 || event.keyCode === 10009;
      const step = event.key === "ArrowDown" ? SCROLL_STEP : event.key === "ArrowUp" ? -SCROLL_STEP : 0;
      // The dialog is the popup's only stop; Tab (a keyboard) must not reach the page behind it.
      if (event.key === "Tab") { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (!back && !step) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (back) close();
      else dialogRef.current?.scrollBy({ top: step, behavior: event.repeat ? "auto" : "smooth" });
    };
    window.addEventListener("keydown", onKey, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", onKey, true); };
  }, [open]);

  function close() {
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
  }

  return (
    <>
      <button ref={buttonRef} type="button" data-tv-focusable="true" className="overview-button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className={className}>{preview ?? text}</span>
      </button>
      {open ? createPortal(
        <div className="details-more-scrim" data-modal="true" onClick={close}>
          {/* The one focus stop in the popup: OK anywhere closes it, as on Android TV. */}
          <div ref={dialogRef} className="overview-dialog" role="dialog" aria-label={title ?? "Overview"} tabIndex={-1} data-tv-focusable="true">
            {title ? <h2>{title}</h2> : null}
            <p>{text}</p>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
