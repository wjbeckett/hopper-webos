import { useEffect, useRef, useSyncExternalStore } from "react";
import { answerPhoneRequest, phoneRequests, subscribePhoneRequests } from "../control/hub";

const isBack = (event: KeyboardEvent) =>
  ["Escape", "Backspace", "Back", "GoBack", "BrowserBack"].includes(event.key) || event.keyCode === 461 || event.keyCode === 10009;
const isEnter = (event: KeyboardEvent) => event.key === "Enter" || event.keyCode === 13;

/**
 * "Allow <phone> to control this TV?" (#162): shown over any screen, the player included, when a
 * phone the TV doesn't know connects. It takes every key while it is up, so neither the screen
 * underneath nor the player's own key map acts on them, and returns focus when it closes.
 */
export function PhoneApproval() {
  const request = useSyncExternalStore(subscribePhoneRequests, () => phoneRequests()[0] ?? null);
  const dialog = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const id = request?.id;

  useEffect(() => {
    if (!id) return;
    if (!returnFocus.current) {
      returnFocus.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    }
    const buttons = () => Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    buttons()[0]?.focus({ preventScroll: true });
    let answered = false;
    const answer = (value: "allow" | "refuse" | "dismiss", byKey: boolean) => {
      if (answered) return;
      answered = true;
      // The key-up of the press that answered must not reach the screen underneath.
      if (byKey) {
        const swallow = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
        window.addEventListener("keyup", swallow, { capture: true, once: true });
      }
      answerPhoneRequest(id, value);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      const list = buttons();
      const at = list.indexOf(document.activeElement as HTMLButtonElement);
      if (isBack(event)) answer("dismiss", true);
      else if (isEnter(event)) {
        const target = list[at] ?? list[0];
        if (target) answer(target.dataset.answer === "allow" ? "allow" : "refuse", true);
      } else if (event.key === "ArrowLeft" || event.keyCode === 37) list[Math.max(0, at - 1)]?.focus({ preventScroll: true });
      else if (event.key === "ArrowRight" || event.keyCode === 39) list[Math.min(list.length - 1, at + 1)]?.focus({ preventScroll: true });
    };
    const onKeyUp = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || dialog.current?.contains(target)) return;
      returnFocus.current = target;
      buttons()[0]?.focus({ preventScroll: true });
    };
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button[data-answer]");
      if (!target || !dialog.current?.contains(target)) return;
      answer(target.dataset.answer === "allow" ? "allow" : "refuse", false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("focusin", onFocusIn);
    dialog.current?.addEventListener("click", onClick);
    const node = dialog.current;
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("focusin", onFocusIn);
      node?.removeEventListener("click", onClick);
    };
  }, [id]);

  // Focus goes back where it was once no phone is waiting.
  useEffect(() => {
    if (request) return;
    const previous = returnFocus.current;
    returnFocus.current = null;
    if (previous?.isConnected) requestAnimationFrame(() => previous.focus({ preventScroll: true }));
  }, [request]);

  if (!request) return null;
  return (
    <div className="details-more-scrim phone-approval-scrim" data-modal="true">
      <div className="details-more settings-confirm" role="alertdialog" aria-label="Allow phone" ref={dialog}>
        <h2>Allow {request.deviceName} to control this TV?</h2>
        <p>It will be able to play titles and control what's playing. The TV remembers it; you can forget it in Settings.</p>
        <div className="settings-confirm-actions">
          <button type="button" className="tv-button" data-tv-focusable="true" data-answer="allow">Allow</button>
          <button type="button" className="tv-button secondary" data-tv-focusable="true" data-answer="refuse">Don't allow</button>
        </div>
      </div>
    </div>
  );
}
