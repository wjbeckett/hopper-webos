/**
 * TV paint window for card grids (`.library-grid`): only cards within PAINT_WINDOW_ROWS rows of
 * the focused card paint; the rest get `.grid-far` (visibility: hidden). Measured on the TV in
 * library Browse: 150 ms -> about 17 ms per frame with a few hundred cards. Classes are toggled
 * on the DOM directly, so a key press never re-renders the grid.
 *
 * It runs on every focus change, so it must not force a style pass: the column count is cached
 * (gridColumns), and only the cards that enter or leave the window are touched.
 */
const PAINT_WINDOW_ROWS = 6;
type Window = { start: number; end: number; count: number };
const windows = new WeakMap<HTMLElement, Window>();
const columnCache = new WeakMap<HTMLElement, { key: string; columns: number }>();

/**
 * Columns of a CSS grid. Reading the computed template forces a style pass, which on a TV costs
 * milliseconds per key press, so it is read once per grid, screen width and text/poster size.
 */
export function gridColumns(grid: HTMLElement) {
  const root = document.documentElement;
  const key = `${window.innerWidth}|${root.dataset.posterSize ?? ""}|${root.dataset.textScale ?? ""}|${grid.className}`;
  const cached = columnCache.get(grid);
  if (cached && cached.key === key) return cached.columns;
  const template = getComputedStyle(grid).gridTemplateColumns;
  const columns = Math.max(1, template && template !== "none" ? template.trim().split(/\s+/).length : 1);
  columnCache.set(grid, { key, columns });
  return columns;
}

function setFar(children: HTMLCollection, from: number, to: number, far: boolean) {
  for (let i = Math.max(0, from); i < Math.min(children.length, to); i++) {
    if (children[i].classList.contains("grid-far") !== far) children[i].classList.toggle("grid-far", far);
  }
}

export function applyGridPaintWindow(grid: HTMLElement, focused?: Element | null) {
  const children = grid.children;
  if (!children.length) return;
  const columns = gridColumns(grid);
  const last = windows.get(grid);
  let index = 0;
  const host = focused?.closest(".library-grid > *");
  if (host && host.parentElement === grid) index = Array.prototype.indexOf.call(children, host);
  else if (last) index = last.start + PAINT_WINDOW_ROWS * columns; // keep the current window
  const row = Math.floor(index / columns);
  const start = Math.max(0, (row - PAINT_WINDOW_ROWS) * columns);
  const end = Math.min(children.length, (row + PAINT_WINDOW_ROWS + 1) * columns);
  if (!last || last.count !== children.length) {
    // First pass, or cards were added or removed: set every card.
    setFar(children, 0, start, true);
    setFar(children, start, end, false);
    setFar(children, end, children.length, true);
  } else {
    // Only the cards that left or entered the window change.
    setFar(children, last.start, Math.min(last.end, start), true);
    setFar(children, Math.max(last.start, end), last.end, true);
    setFar(children, start, Math.min(end, last.start), false);
    setFar(children, Math.max(start, last.end), end, false);
  }
  windows.set(grid, { start, end, count: children.length });
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
