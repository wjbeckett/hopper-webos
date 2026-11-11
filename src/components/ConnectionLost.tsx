import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { checkConnection, connectionDialogHeld, connectionStatus, subscribeConnection, subscribeDialogHold } from "../api/connection";
import { focusTopNavigation } from "../navigation/spatial";
import { TvButton } from "./TvButton";

const isBack = (event: KeyboardEvent) =>
  ["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) || event.keyCode === 461 || event.keyCode === 10009;

/**
 * What browsing shows while the server cannot be reached: a dialog with "Try again", and
 * after it is dismissed a small notice. Both go away by themselves when the server answers.
 * Android TV shows an "Offline mode - select to retry" pill in the same situation.
 */
export function ConnectionLost({ serverName }: { serverName: string }) {
  const status = useSyncExternalStore(subscribeConnection, connectionStatus);
  const held = useSyncExternalStore(subscribeDialogHold, connectionDialogHeld);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [stillDown, setStillDown] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const lost = status === "unreachable" && !held;
  const open = lost && !dismissed;

  useEffect(() => {
    if (status === "reachable") { setDismissed(false); setStillDown(false); }
  }, [status]);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isBack(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) setDismissed(true);
    };
    // A screen that opens underneath (Back out of the player, say) focuses its own first
    // control. Take focus back, and return it to that control when the dialog closes.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || dialog.current?.contains(target)) return;
      returnFocus.current = target;
      dialog.current?.querySelector<HTMLElement>("[data-tv-focusable='true']")?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      const previous = returnFocus.current;
      returnFocus.current = null;
      // After a reload the old control is gone and the screen focuses its own content.
      requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus({ preventScroll: true });
        else if (!document.activeElement || document.activeElement === document.body) focusTopNavigation();
      });
    };
  }, [open]);

  if (!lost) return null;
  if (!open) return <div className="connection-notice" role="status">Can't reach {serverName}. Trying again…</div>;

  const retry = () => {
    if (checking) return;
    setChecking(true);
    setStillDown(false);
    void checkConnection().then(ok => { setChecking(false); setStillDown(!ok); });
  };

  return (
    <div className="details-more-scrim connection-lost-scrim" data-modal="true">
      <div className="details-more settings-confirm" role="alertdialog" aria-label="Connection lost" ref={dialog}>
        <h2>Can't reach {serverName}</h2>
        <p>Check this TV's network connection. Hopper keeps trying and carries on when the server answers.</p>
        {stillDown ? <p className="connection-lost-status" role="status">Still no answer from the server.</p> : null}
        <div className="settings-confirm-actions">
          <TvButton autoFocus onClick={retry} aria-disabled={checking}>{checking ? "Checking…" : "Try again"}</TvButton>
          <TvButton className="secondary" onClick={() => setDismissed(true)}>Dismiss</TvButton>
        </div>
      </div>
    </div>
  );
}
