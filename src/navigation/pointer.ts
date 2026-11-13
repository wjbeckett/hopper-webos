/**
 * Magic Remote pointer support.
 *
 * LG requires every control to work with the pointer and to show a selection effect when it
 * is pointed at. The app is built around focus, so the pointer drives focus: pointing at a
 * control focuses it. It then looks selected, and OK or a click acts on what is highlighted,
 * the same as with the D-pad.
 *
 * Rows of cards cannot be scrolled with the pointer (Home's rows do not scroll at all), so
 * while the pointer is over a row, arrows at its edges page it sideways.
 */
import { focusNavigationTarget, RAIL_SELECTOR, scrollLibraryResultsBy } from "./spatial";

/** Controls the D-pad can reach. The player moves focus itself and does not mark its buttons, so they are named here. */
const FOCUSABLE = "[data-tv-focusable='true'], .player-shell button";
/** Focusing a text field opens the TV's keyboard, so these are left to a click. They get a hover style instead. */
const TEXT_ENTRY = "input, textarea, select, [contenteditable='true']";
/** How far a row moves per press of an arrow, as a share of its visible width. */
const PAGE_SHARE = 0.8;

let focusing = false;
/**
 * True while focus is moving because the pointer moved. Screens that bring the focused item
 * into view skip that then: moving the page under the pointer would put a different control
 * under it.
 */
export function focusFromPointer() {
  return focusing;
}

type Pager = { previous: HTMLButtonElement; next: HTMLButtonElement; rail: HTMLElement | null };

function arrowButton(direction: "previous" | "next") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `pointer-pager ${direction}`;
  button.tabIndex = -1;
  button.setAttribute("aria-label", direction === "next" ? "Show more" : "Show previous");
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${direction === "next" ? "m9 5 7 7-7 7" : "m15 5-7 7 7 7"}" /></svg>`;
  return button;
}

/** The part of a row that shows cards: inside its padding and inside the screen. */
function railView(rail: HTMLElement) {
  const rect = rail.getBoundingClientRect();
  const style = getComputedStyle(rail);
  const left = Math.max(0, rect.left + (Number.parseFloat(style.paddingLeft) || 0));
  const right = Math.min(window.innerWidth, rect.right - (Number.parseFloat(style.paddingRight) || 0));
  return { rect, left, right, width: Math.max(0, right - left) };
}

/** Whether the row has cards past each edge. */
function railOverflow(rail: HTMLElement) {
  if (rail.dataset.slide === "true") {
    const strip = rail.firstElementChild as HTMLElement | null;
    if (!strip) return { previous: false, next: false };
    const offset = Number(strip.dataset.offset ?? 0) || 0;
    return { previous: offset > 0, next: offset < Math.max(strip.offsetWidth, strip.scrollWidth) - railView(rail).width - 1 };
  }
  return { previous: rail.scrollLeft > 1, next: rail.scrollLeft < rail.scrollWidth - rail.clientWidth - 1 };
}

function placePager(pager: Pager) {
  const rail = pager.rail;
  if (!rail || !rail.isConnected) {
    pager.rail = null;
    pager.previous.classList.remove("visible");
    pager.next.classList.remove("visible");
    return;
  }
  const view = railView(rail);
  const overflow = railOverflow(rail);
  const top = `${Math.round(view.rect.top + view.rect.height / 2)}px`;
  pager.previous.style.top = top;
  pager.next.style.top = top;
  pager.previous.style.left = `${Math.round(Math.max(0, view.rect.left) + 16)}px`;
  pager.next.style.left = `${Math.round(Math.min(window.innerWidth, view.rect.right) - 16 - 64)}px`;
  pager.previous.classList.toggle("visible", overflow.previous);
  pager.next.classList.toggle("visible", overflow.next);
}

/** Moves the row about a screen's worth by focusing a card that far along; the row follows focus as it does for the D-pad. */
function pageRail(rail: HTMLElement, direction: 1 | -1) {
  const view = railView(rail);
  const wanted = (view.left + view.right) / 2 + direction * view.width * PAGE_SHARE;
  const cards = Array.from(rail.querySelectorAll<HTMLElement>(`${FOCUSABLE}:not([disabled])`)).filter(card => card.offsetParent !== null);
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const distance = Math.abs(rect.left + rect.width / 2 - wanted);
    if (distance < bestDistance) { best = card; bestDistance = distance; }
  }
  if (best) focusNavigationTarget(best);
}

/** Installs pointer handling for the whole app. Returns the function that removes it. */
export function installPointerNavigation() {
  const pager: Pager = { previous: arrowButton("previous"), next: arrowButton("next"), rail: null };
  document.body.append(pager.previous, pager.next);
  let lastX = -1;
  let lastY = -1;
  let settle = 0;

  const hidePager = () => { pager.rail = null; placePager(pager); };

  const onMove = (event: MouseEvent) => {
    // The page moving under a still pointer also reports a move. Only a real one counts,
    // or a row sliding under the pointer would keep handing focus to the next card.
    if (event.clientX === lastX && event.clientY === lastY) return;
    lastX = event.clientX;
    lastY = event.clientY;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (!target.closest(".pointer-pager")) {
      // The season buttons are a sliding row too: the arrows are how the pointer reaches the clipped ones.
      const rail = target.closest<HTMLElement>(`${RAIL_SELECTOR}, .season-tabs`);
      if (rail !== pager.rail) { pager.rail = rail; placePager(pager); }
    }
    const control = target.closest<HTMLElement>(FOCUSABLE);
    if (!control || control === document.activeElement || control.matches(":disabled") || control.matches(TEXT_ENTRY)) return;
    // With a dialog or panel open, only its own controls can be pointed at, as with the D-pad.
    const overlays = document.querySelectorAll<HTMLElement>("[data-modal='true'], [role='dialog']");
    const overlay = overlays[overlays.length - 1];
    if (overlay && !overlay.contains(control)) return;
    focusing = true;
    try { control.focus({ preventScroll: true }); } finally { focusing = false; }
  };

  const onPage = (direction: 1 | -1) => (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!pager.rail || !pager.rail.isConnected) { hidePager(); return; }
    pageRail(pager.rail, direction);
    // The row slides for a moment; then show only the arrows that still lead somewhere.
    window.clearTimeout(settle);
    settle = window.setTimeout(() => placePager(pager), 260);
  };
  const pagePrevious = onPage(-1);
  const pageNext = onPage(1);
  // A click that opens something leaves the arrows over a screen they do not belong to.
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || !event.target.closest(".pointer-pager")) hidePager();
  };
  // LG hides the pointer when the D-pad is used and reports it with this event.
  const onCursor = (event: Event) => {
    if ((event as CustomEvent<{ visibility?: boolean }>).detail?.visibility === false) hidePager();
  };

  pager.previous.addEventListener("click", pagePrevious);
  pager.next.addEventListener("click", pageNext);
  // Library Browse on a TV moves by transform, so the wheel cannot scroll it natively (#83).
  const onWheel = (event: WheelEvent) => {
    const results = event.target instanceof Element ? event.target.closest<HTMLElement>(".library-results") : null;
    if (results && scrollLibraryResultsBy(results, event.deltaY)) event.preventDefault();
  };
  document.addEventListener("wheel", onWheel, { passive: false });
  document.addEventListener("mousemove", onMove, { passive: true });
  document.addEventListener("click", onClick, true);
  document.addEventListener("cursorStateChange", onCursor);
  window.addEventListener("keydown", hidePager, true);
  return () => {
    window.clearTimeout(settle);
    document.removeEventListener("wheel", onWheel);
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("cursorStateChange", onCursor);
    window.removeEventListener("keydown", hidePager, true);
    pager.previous.remove();
    pager.next.remove();
  };
}
