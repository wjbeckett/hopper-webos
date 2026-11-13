/**
 * TV paint window for card grids (`.library-grid`): only cards within PAINT_WINDOW_ROWS rows of
 * the focused card paint; the rest get `.grid-far` (visibility: hidden). Measured on the TV in
 * library Browse: 150 ms -> about 17 ms per frame with a few hundred cards. Classes are toggled
 * on the DOM directly, so a key press never re-renders the grid.
 */
const PAINT_WINDOW_ROWS = 6;
const lastStarts = new WeakMap<HTMLElement, number>();

export function applyGridPaintWindow(grid: HTMLElement, focused?: Element | null) {
  const children = grid.children;
  if (!children.length) return;
  const template = getComputedStyle(grid).gridTemplateColumns;
  const columns = Math.max(1, template && template !== "none" ? template.trim().split(/\s+/).length : 1);
  const lastStart = lastStarts.get(grid) ?? -1;
  let index = 0;
  const host = focused?.closest(".library-grid > *");
  if (host && host.parentElement === grid) index = Array.prototype.indexOf.call(children, host);
  else if (lastStart >= 0) index = lastStart + PAINT_WINDOW_ROWS * columns; // keep the current window
  const row = Math.floor(index / columns);
  const start = Math.max(0, (row - PAINT_WINDOW_ROWS) * columns);
  const end = Math.min(children.length, (row + PAINT_WINDOW_ROWS + 1) * columns);
  // classList.toggle with a force flag is a no-op when the state is unchanged, so no style
  // invalidation happens for the cards that stay on the same side of the window.
  for (let i = 0; i < children.length; i++) {
    const far = i < start || i >= end;
    if (children[i].classList.contains("grid-far") !== far) children[i].classList.toggle("grid-far", far);
  }
  lastStarts.set(grid, start);
}

/** Applies the paint window to whichever grid gains focus, on every screen. Returns the remover. */
export function installGridPaintWindow() {
  const onFocus = (event: FocusEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const grid = target?.closest<HTMLElement>(".library-grid");
    if (grid) applyGridPaintWindow(grid, target);
  };
  document.addEventListener("focusin", onFocus);
  return () => document.removeEventListener("focusin", onFocus);
}
