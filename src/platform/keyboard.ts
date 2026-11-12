/**
 * Whether the TV's on-screen keyboard is showing. webOS 3.0 and later report it with a
 * `keyboardStateChange` event on the document (`detail.visibility`). Elsewhere, including
 * a desktop browser, the event never fires and the keyboard counts as hidden.
 */
let visible = false;

export function virtualKeyboardVisible(): boolean {
  return visible;
}

/** Starts tracking the keyboard. Returns a function that stops it. */
export function installKeyboardTracking(): () => void {
  const onChange = (event: Event) => {
    visible = (event as CustomEvent<{ visibility?: boolean }>).detail?.visibility === true;
  };
  document.addEventListener("keyboardStateChange", onChange);
  return () => {
    document.removeEventListener("keyboardStateChange", onChange);
    visible = false;
  };
}
