export type Direction = "left" | "right" | "up" | "down";

const directionKeys: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down"
};

let consumeEnterKeyUp = false;

function center(rect: DOMRect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

export function candidateScore(from: DOMRect, to: DOMRect, direction: Direction) {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  if (direction === "left" && dx >= -1) return Infinity;
  if (direction === "right" && dx <= 1) return Infinity;
  if (direction === "up" && dy >= -1) return Infinity;
  if (direction === "down" && dy <= 1) return Infinity;

  const horizontal = direction === "left" || direction === "right";
  const primary = horizontal ? Math.abs(dx) : Math.abs(dy);
  const cross = horizontal ? Math.abs(dy) : Math.abs(dx);
  return primary + cross * 2.2;
}

export const RAIL_SELECTOR = ".episode-rail, .detail-cast-track, .detail-trailer-track, .rail-track, .player-on-deck-row";
const RAIL_PIN_MS = 100;
const railAnimations = new WeakMap<HTMLElement, number>();
const railInlineStyles = new WeakMap<HTMLElement, { snap: string; behavior: string }>();
let railStepUntil = 0;

function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t);
}

/** Android's tvRailPinOnFocus: the focused card's leading edge slides to the rail's start padding; the row's ends clamp, which is the only time the selector moves. */
function pinRailItem(rail: HTMLElement, element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const railRect = rail.getBoundingClientRect();
  const leading = Number.parseFloat(getComputedStyle(rail).paddingLeft) || 0;
  const maxScroll = rail.scrollWidth - rail.clientWidth;
  // Media rails use a Plex-style middle lock: the selector travels until its card is centred,
  // the row then scrolls under it, and the clamp at either end lets the selector move on.
  const middleLock = rail.classList.contains("rail-track");
  const wanted = middleLock
    ? rail.scrollLeft + (rect.left + rect.width / 2) - (railRect.left + railRect.width / 2)
    : rail.scrollLeft + rect.left - railRect.left - leading;
  const target = Math.max(0, Math.min(maxScroll, wanted));
  // One animation per row, always restarted from where the row is now, so presses retarget
  // smoothly instead of fighting a running slide or the native smooth scroll.
  const start = rail.scrollLeft;
  const distance = target - start;
  const running = railAnimations.get(rail);
  if (running) cancelAnimationFrame(running);
  if (Math.abs(distance) < 1) return;
  const began = performance.now();
  railStepUntil = began + RAIL_PIN_MS;
  if (!railInlineStyles.has(rail)) railInlineStyles.set(rail, { snap: rail.style.scrollSnapType, behavior: rail.style.scrollBehavior });
  const original = railInlineStyles.get(rail)!;
  rail.style.scrollSnapType = "none";
  rail.style.scrollBehavior = "auto";
  const tick = (now: number) => {
    // The frame timestamp can predate `began` (the key was handled mid-frame); a negative
    // progress would overshoot backwards, so clamp both ends.
    const progress = Math.max(0, Math.min(1, (now - began) / RAIL_PIN_MS));
    rail.scrollLeft = start + distance * easeOut(progress);
    if (progress < 1) railAnimations.set(rail, requestAnimationFrame(tick));
    else {
      railAnimations.delete(rail);
      rail.style.scrollSnapType = original.snap;
      rail.style.scrollBehavior = original.behavior;
      railInlineStyles.delete(rail);
    }
  };
  railAnimations.set(rail, requestAnimationFrame(tick));
}

/**
 * Rows marked data-slide (Home's rails) do not scroll. Their strip of cards is translated
 * with a CSS transition, so a move is one style change and the compositor animates it; a
 * scripted scroll cost a compositing update and a commit on every frame. Same middle lock
 * as pinRailItem: the focused card is centred, and the row's ends clamp.
 */
function slideRailItem(rail: HTMLElement, element: HTMLElement) {
  const strip = rail.firstElementChild as HTMLElement | null;
  // The strip's child that holds the focused control: a card's wrapper, or the control itself.
  let wrap: HTMLElement = element;
  while (wrap.parentElement && wrap.parentElement !== strip && wrap.parentElement !== rail) wrap = wrap.parentElement;
  if (!strip || wrap.parentElement !== strip) return;
  // The row never scrolls; something like scrollIntoView may still have moved it.
  if (rail.scrollLeft) rail.scrollLeft = 0;
  const style = getComputedStyle(rail);
  const view = rail.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
  // scrollWidth too: Chrome 87 can size a flex strip narrower than its fixed-basis cards.
  const maxOffset = Math.max(0, Math.max(strip.offsetWidth, strip.scrollWidth) - view);
  const centre = wrap.offsetLeft + wrap.offsetWidth / 2;
  const offset = Math.round(Math.max(0, Math.min(maxOffset, centre - view / 2)));
  if (strip.dataset.offset === String(offset)) return;
  strip.dataset.offset = String(offset);
  strip.style.transform = offset ? `translate3d(${-offset}px, 0, 0)` : "";
  railStepUntil = performance.now() + RAIL_PIN_MS;
}

/** Puts a sliding row back at its start, without animating (a new season's episodes, say). */
export function resetSlidingRail(rail: HTMLElement | null) {
  const strip = rail?.firstElementChild as HTMLElement | null | undefined;
  if (!rail || !strip) return;
  rail.scrollLeft = 0;
  delete strip.dataset.offset;
  strip.style.transition = "none";
  strip.style.transform = "";
  void strip.offsetWidth;
  strip.style.transition = "";
}

/** Brings a card into its sliding row at once, without animating (on entry, or when focus is restored). */
export function placeRailItem(element: HTMLElement) {
  const rail = element.closest<HTMLElement>(RAIL_SELECTOR);
  const strip = rail?.firstElementChild as HTMLElement | null | undefined;
  if (rail?.dataset.slide !== "true" || !strip) { pinFocusedRailItem(element); return; }
  strip.style.transition = "none";
  slideRailItem(rail, element);
  void strip.offsetWidth;
  strip.style.transition = "";
}

export function pinFocusedRailItem(element: HTMLElement) {
  const rail = element.closest<HTMLElement>(RAIL_SELECTOR);
  if (rail?.dataset.slide === "true") slideRailItem(rail, element);
  else if (rail && rail.scrollWidth > rail.clientWidth + 1) pinRailItem(rail, element);
}

/**
 * Vertical twin of the rail slide. Repeated presses retarget one running animation
 * from an absolute goal, instead of stacking native smooth scrolls that lag behind
 * the selector and stutter until the key is released.
 */
const VERTICAL_SLIDE_MS = 140;
/** True while the key being handled is a held key's repeat: moves then jump instead of easing. */
let keyHeld = false;
const verticalSlides = new WeakMap<HTMLElement, { frame: number; goal: number }>();

function slideScrollTop(container: HTMLElement, delta: number) {
  const running = verticalSlides.get(container);
  if (running) cancelAnimationFrame(running.frame);
  const maxScroll = container.scrollHeight - container.clientHeight;
  // `delta` is measured against the current (mid-slide) position, so the goal is absolute
  // and always lands the newly focused card in view, however fast the presses come.
  const start = container.scrollTop;
  const goal = Math.max(0, Math.min(maxScroll, start + delta));
  const distance = goal - start;
  if (Math.abs(distance) < 1) {
    verticalSlides.delete(container);
    return;
  }
  container.style.scrollBehavior = "auto";
  if (running || keyHeld) {
    // A press arrived mid-slide (key held or rapid presses): jump straight to the goal so the
    // selector never trails off screen. Single presses still get the eased slide.
    container.scrollTop = goal;
    verticalSlides.delete(container);
    return;
  }
  const began = performance.now();
  const tick = (now: number) => {
    const progress = Math.max(0, Math.min(1, (now - began) / VERTICAL_SLIDE_MS));
    container.scrollTop = start + distance * easeOut(progress);
    if (progress < 1) verticalSlides.set(container, { frame: requestAnimationFrame(tick), goal });
    else verticalSlides.delete(container);
  };
  verticalSlides.set(container, { frame: requestAnimationFrame(tick), goal });
}

/**
 * Keeps a focused card in view by scrolling whatever holds it (a grid's container, a Details
 * page), through the same
 * slide as library Browse: eased for one press, a jump while a key is held. A native smooth
 * scroll per press stacked up under a held key and left the selector off screen (#83).
 */
function keepInViewVertically(element: HTMLElement, anchorTop = false) {
  let container: HTMLElement | null = element.parentElement;
  while (container && container !== document.body) {
    const overflow = getComputedStyle(container).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && container.scrollHeight > container.clientHeight + 1) break;
    container = container.parentElement;
  }
  const page = !container || container === document.body;
  const scroller = page ? (document.scrollingElement as HTMLElement | null) : container;
  if (!scroller) return;
  const top = page ? 0 : scroller.getBoundingClientRect().top;
  const height = page ? window.innerHeight : scroller.clientHeight;
  const rect = element.getBoundingClientRect();
  // A row that is fully on screen with the page at its top keeps the page there, so the
  // buttons above it and the row hold still while focus moves between them.
  if (anchorTop && scroller.scrollTop + rect.bottom - top <= height - 24) {
    if (scroller.scrollTop) slideScrollTop(scroller, -scroller.scrollTop);
    return;
  }
  const visibleStart = top + height * 0.12;
  const visibleEnd = top + height * 0.78;
  const delta = rect.top < visibleStart ? rect.top - visibleStart : rect.bottom > visibleEnd ? rect.bottom - visibleEnd : 0;
  if (delta) slideScrollTop(scroller, delta);
}

/**
 * The card last focused in each row. Up or Down into a row lands on it, as Android TV does,
 * and on the row's first card when the row has not been visited.
 */
const lastInRow = new WeakMap<HTMLElement, HTMLElement>();

/** Where focus should land when it moves into `row` from above or below. */
function rowEntry(row: HTMLElement): HTMLElement | undefined {
  const remembered = lastInRow.get(row);
  if (remembered?.isConnected && row.contains(remembered) && !remembered.matches(":disabled")) return remembered;
  return focusables("[data-tv-focusable='true']").find(item => row.contains(item) && item.offsetParent !== null);
}

function focusElement(element: HTMLElement) {
  element.focus({ preventScroll: true });
  const row = element.closest<HTMLElement>(RAIL_SELECTOR);
  if (row && !row.closest(".home-rails")) lastInRow.set(row, element);
  const libraryResults = element.closest<HTMLElement>(".library-results");
  if (libraryResults) {
    const elementRect = element.getBoundingClientRect();
    const resultsRect = libraryResults.getBoundingClientRect();
    const leadingGutter = resultsRect.height * 0.12;
    const trailingGutter = resultsRect.height * 0.22;
    const visibleStart = resultsRect.top + leadingGutter;
    const visibleEnd = resultsRect.bottom - trailingGutter;
    const topDelta = elementRect.top < visibleStart ? elementRect.top - visibleStart : 0;
    const bottomDelta = elementRect.bottom > visibleEnd ? elementRect.bottom - visibleEnd : 0;
    const delta = topDelta || bottomDelta;
    if (delta) slideScrollTop(libraryResults, delta);

    const horizontalContainer = element.closest<HTMLElement>(".library-filter-row");
    if (horizontalContainer) {
      const rowRect = horizontalContainer.getBoundingClientRect();
      const leftDelta = elementRect.left < rowRect.left
        ? elementRect.left - rowRect.left - 12
        : elementRect.right > rowRect.right
          ? elementRect.right - rowRect.right + 12
          : 0;
      if (leftDelta) horizontalContainer.scrollBy({ left: leftDelta, behavior: "smooth" });
    }
    return;
  }

  const scrollContainer = element.closest<HTMLElement>(
    ".library-alpha-nav, .library-filter-row, .library-view-tabs, .browse-panel-facet-list, .browse-panel-option-list, .browse-panel-list"
  );
  if (scrollContainer) {
    const elementRect = element.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    const topDelta = elementRect.top < containerRect.top
      ? elementRect.top - containerRect.top - 20
      : elementRect.bottom > containerRect.bottom
        ? elementRect.bottom - containerRect.bottom + 20
        : 0;
    const leftDelta = elementRect.left < containerRect.left
      ? elementRect.left - containerRect.left - 12
      : elementRect.right > containerRect.right
        ? elementRect.right - containerRect.right + 12
        : 0;
    if (topDelta || leftDelta) {
      scrollContainer.scrollBy({
        top: topDelta,
        left: leftDelta,
        behavior: "smooth"
      });
    }
    return;
  }
  if (element.closest(".details-actions, .overview-button, .season-tabs")) {
    const page = element.closest<HTMLElement>(".details-shell, .series-screen, .person-screen");
    // A slide down that is still running would carry on after this scroll up and leave the
    // buttons off screen.
    for (const scroller of [page, document.scrollingElement as HTMLElement | null]) {
      const running = scroller ? verticalSlides.get(scroller) : undefined;
      if (scroller && running) {
        cancelAnimationFrame(running.frame);
        verticalSlides.delete(scroller);
      }
    }
    page?.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const rail = element.closest<HTMLElement>(RAIL_SELECTOR);
  if (rail?.dataset.slide === "true") {
    slideRailItem(rail, element);
    // Home moves its band itself. Elsewhere (Details, Series) the page scrolls to the row.
    if (!element.closest(".home-rails")) keepInViewVertically(element, true);
    return;
  }
  if (rail && rail.scrollWidth > rail.clientWidth + 1) {
    pinRailItem(rail, element);
    if (!element.closest(".home-rails")) element.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
    return;
  }

  if (element.closest(".tv-nav")) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.querySelector<HTMLElement>(".library-results")?.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (element.closest(".library-screen, .home-rails")) return;
  if (element.closest(".library-grid")) {
    keepInViewVertically(element);
    return;
  }
  element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
}

function focusables(selector: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(`${selector}:not([disabled])`))
    .filter(element => element.offsetParent !== null);
}

export function focusFirstContentCard() {
  const activeElement = document.activeElement;
  const activeNavItem = document.querySelector<HTMLElement>(".tv-nav [data-nav-primary][aria-current='page']");
  if (
    activeElement instanceof HTMLElement
    && activeElement !== document.body
    && !activeElement.closest(".tv-nav")
    && activeElement.isConnected
  ) return;
  if (activeElement instanceof HTMLElement && activeElement.closest(".tv-nav") && activeElement !== activeNavItem) return;
  attemptFirstContentFocus(1);
}

let pendingFirstFocus: symbol | null = null;

export function attemptFirstContentFocus(remaining: number) {
  if (remaining <= 0) return;
  const token = Symbol();
  pendingFirstFocus = token;
  const cancel = () => { if (pendingFirstFocus === token) pendingFirstFocus = null; };
  window.addEventListener("keydown", cancel, { once: true });
  const tick = (left: number) => {
    if (pendingFirstFocus !== token) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active.isConnected && !active.closest(".tv-nav")) {
      cancel();
      return;
    }
    const firstCard = focusables(".content-screen .media-card")[0];
    const firstContentControl = focusables(".content-screen [data-tv-focusable='true']")[0];
    const target = firstCard ?? firstContentControl;
    if (target) {
      focusElement(target);
      cancel();
      return;
    }
    if (left > 0) requestAnimationFrame(() => tick(left - 1));
    else cancel();
  };
  requestAnimationFrame(() => tick(remaining - 1));
}

export function focusTopNavigation(target?: HTMLElement | null) {
  const navItem = target ?? document.querySelector<HTMLElement>(".tv-nav [data-nav-primary][aria-current='page']");
  if (navItem) focusElement(navItem);
}

export function focusNavigationTarget(element: HTMLElement) {
  focusElement(element);
}

function focusFirstContentBelow(current: HTMLElement) {
  const browseControl = focusables(".content-screen .browse-toolbar [data-browse-dropdown-trigger]")[0];
  if (browseControl) {
    focusElement(browseControl);
    return true;
  }
  const cards = focusables(".content-screen .media-card");
  const candidates = cards.length
    ? cards
    : focusables(".content-screen [data-tv-focusable='true']");
  const currentRect = current.getBoundingClientRect();
  const target = candidates
    .map(candidate => ({
      candidate,
      score: candidateScore(currentRect, candidate.getBoundingClientRect(), "down")
    }))
    .sort((left, right) => left.score - right.score)[0];
  if (!target || !Number.isFinite(target.score)) return false;
  focusElement(target.candidate);
  return true;
}

function focusAdjacent(current: HTMLElement, candidates: HTMLElement[], direction: Direction) {
  const currentRect = current.getBoundingClientRect();
  const next = candidates
    .filter(candidate => candidate !== current)
    .map(candidate => ({
      candidate,
      score: candidateScore(currentRect, candidate.getBoundingClientRect(), direction)
    }))
    .sort((a, b) => a.score - b.score)[0];
  if (!next || !Number.isFinite(next.score)) return false;
  focusElement(next.candidate);
  return true;
}

function navigateTopNav(current: HTMLElement, direction: Direction) {
  const primaryItems = focusables(".tv-nav [data-nav-primary]");

  if (current.matches(".tv-nav [data-nav-primary]")) {
    if (direction === "left" || direction === "right") {
      if (focusAdjacent(current, primaryItems, direction)) return true;
      if (direction === "right") {
        const profile = focusables(".tv-nav .profile-pill")[0];
        if (profile) focusElement(profile);
      }
      return true;
    }
    if (direction === "down") {
      const entry = current.closest<HTMLElement>(".nav-entry");
      const firstCalloutItem = entry
        ? Array.from(entry.querySelectorAll<HTMLElement>("[data-nav-callout-item]"))
          .filter(item => item.offsetParent !== null)[0]
        : undefined;
      if (firstCalloutItem) {
        focusElement(firstCalloutItem);
        return true;
      }

      focusFirstContentBelow(current);
      return true;
    }
    return true;
  }

  if (!current.matches(".tv-nav [data-nav-callout-item]")) return false;

  const group = current.closest<HTMLElement>("[data-nav-callout-group]");
  const groupItems = group
    ? Array.from(group.querySelectorAll<HTMLElement>("[data-nav-callout-item]"))
      .filter(item => item.closest("[data-nav-callout-group]") === group && item.offsetParent !== null)
    : [];
  const index = groupItems.indexOf(current);
  const nestedMenu = current.closest(".nav-series-subcallout");
  const libraryItem = current.matches("[data-nav-series-library]");

  if (direction === "up" || direction === "down") {
    const target = groupItems[index + (direction === "down" ? 1 : -1)];
    if (target) {
      focusElement(target);
    } else if (direction === "up") {
      const parent = nestedMenu
        ? nestedMenu.closest<HTMLElement>(".nav-series-entry")?.querySelector<HTMLElement>("[data-nav-series-library]")
        : current.closest<HTMLElement>(".nav-entry")?.querySelector<HTMLElement>("[data-nav-primary]");
      if (parent) focusElement(parent);
    } else if (libraryItem) {
      const entry = current.closest<HTMLElement>(".nav-series-entry");
      const firstOption = entry
        ? Array.from(entry.querySelectorAll<HTMLElement>(".nav-series-subcallout [data-nav-callout-item]"))
          .find(item => item.offsetParent !== null)
        : undefined;
      if (firstOption) focusElement(firstOption);
      else focusFirstContentBelow(current);
    } else {
      focusFirstContentBelow(current);
    }
    return true;
  }

  if (direction === "left") {
    const parent = nestedMenu
      ? nestedMenu.closest<HTMLElement>(".nav-series-entry")?.querySelector<HTMLElement>("[data-nav-series-library]")
      : current.closest<HTMLElement>(".nav-entry")?.querySelector<HTMLElement>("[data-nav-primary]");
    if (parent) focusElement(parent);
    return true;
  }

  if (direction === "right" && libraryItem) {
    const entry = current.closest<HTMLElement>(".nav-series-entry");
    const firstOption = entry
      ? Array.from(entry.querySelectorAll<HTMLElement>(".nav-series-subcallout [data-nav-callout-item]"))
        .find(item => item.offsetParent !== null)
      : undefined;
    if (firstOption) focusElement(firstOption);
    return true;
  }

  return true;
}

function navigateLibrary(current: HTMLElement, direction: Direction) {
  const navItems = focusables(".tv-nav .nav-item");
  const filters = focusables(".library-filter-row [data-tv-focusable='true']");
  const toolbarItems = focusables(".browse-toolbar .browse-dropdown-trigger, .browse-toolbar .browse-shuffle");
  const currentGrid = current.closest<HTMLElement>(".library-grid, .collection-grid")
    ?? current.closest<HTMLElement>(".content-screen")?.querySelector<HTMLElement>(".library-grid, .collection-grid")
    ?? null;
  const gridItems = currentGrid
    ? Array.from(currentGrid.querySelectorAll<HTMLElement>(":scope > [data-tv-focusable='true'], :scope > .media-card-wrap > [data-tv-focusable='true']"))
    : [];
  const jumpItems = focusables(".library-alpha-nav [data-tv-focusable='true']");

  if (current.matches(".tv-nav .nav-item")) {
    if (direction === "left" || direction === "right") {
      if (focusAdjacent(current, navItems, direction)) return true;
      if (direction === "right") {
        const profile = focusables(".tv-nav .profile-pill")[0];
        if (profile) focusElement(profile);
      }
      return true;
    }
    if (direction === "down" && toolbarItems[0]) {
      focusElement(toolbarItems[0]);
      return true;
    }
    return true;
  }

  if (current.matches(".browse-dropdown-option")) {
    const options = focusables(`[data-browse-dropdown-option="${current.dataset.browseDropdownOption}"]`);
    const index = options.indexOf(current);
    if (direction === "up") {
      if (index > 0) focusElement(options[index - 1]);
      else {
        const trigger = focusables(`[data-browse-dropdown-trigger="${current.dataset.browseDropdownOption}"]`)[0];
        if (trigger) focusElement(trigger);
      }
    } else if (direction === "down") {
      if (index + 1 < options.length) focusElement(options[index + 1]);
      else if (gridItems[0]) focusElement(gridItems[0]);
    }
    return true;
  }

  if (current.matches(".browse-dropdown-trigger")) {
    if (direction === "left" || direction === "right") {
      focusAdjacent(current, toolbarItems, direction);
      return true;
    }
    if (direction === "up" && navItems.length) {
      focusElement(navItems.find(item => item.getAttribute("aria-current") === "page") ?? navItems[0]);
      return true;
    }
    if (direction === "down") {
      const dropdown = current.closest<HTMLElement>(".browse-dropdown");
      const firstOption = dropdown
        ? focusables(`[data-browse-dropdown-option="${current.dataset.browseDropdownTrigger}"]`)[0]
        : undefined;
      if (firstOption) focusElement(firstOption);
      else if (gridItems[0]) focusElement(gridItems[0]);
      return true;
    }
    return true;
  }

  if (current.matches(".browse-shuffle")) {
    if (direction === "left" || direction === "right") {
      focusAdjacent(current, toolbarItems, direction);
      return true;
    }
    if (direction === "up" && navItems.length) {
      focusElement(navItems.find(item => item.getAttribute("aria-current") === "page") ?? navItems[0]);
      return true;
    }
    if (direction === "down" && gridItems[0]) focusElement(gridItems[0]);
    return true;
  }

  if (current.matches(".library-filter-row [data-tv-focusable='true']")) {
    if (direction === "left" || direction === "right") {
      focusAdjacent(current, filters, direction);
      return true;
    }
    if (direction === "up") {
      const above = toolbarItems.length
        ? toolbarItems[toolbarItems.length - 1]
        : navItems.find(item => item.getAttribute("aria-current") === "page") ?? navItems[0];
      if (above) {
        focusElement(above);
        return true;
      }
    }
    if (direction === "down") {
      const below = gridItems[0] ?? focusables(".library-results .media-card, .library-results .library-grid [data-tv-focusable='true']")[0];
      if (below) {
        focusElement(below);
        return true;
      }
    }
    return false;
  }

  if (current.matches(".library-alpha-nav [data-tv-focusable='true']")) {
    if (direction === "up" || direction === "down") {
      focusAdjacent(current, jumpItems, direction);
      return true;
    }
    if (direction === "left") {
      const jumpGrid = document.querySelector<HTMLElement>(".library-results .library-grid");
      const jumpGridItems = jumpGrid
        ? Array.from(jumpGrid.querySelectorAll<HTMLElement>(":scope > [data-tv-focusable='true'], :scope > .media-card-wrap > [data-tv-focusable='true']"))
        : [];
      const currentY = center(current.getBoundingClientRect()).y;
      const target = jumpGridItems
        .sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          const rowDistance = Math.abs(center(aRect).y - currentY) - Math.abs(center(bRect).y - currentY);
          return rowDistance || bRect.right - aRect.right;
        })[0];
      if (target) {
        focusElement(target);
        return true;
      }
    }
    return true;
  }

  const currentIndex = currentGrid ? gridItems.indexOf(current) : -1;
  if (currentGrid && currentIndex >= 0) {
    // Index arithmetic, not layout reads: measuring every card on each press cost ~50ms
    // per key on the TV once a few hundred cards were loaded.
    const columns = gridColumnCount(currentGrid);
    const rowStart = currentIndex - (currentIndex % columns);
    const sameRow = gridItems.slice(rowStart, rowStart + columns);
    if (direction === "down" || direction === "up") {
      const target = direction === "down"
        ? (currentIndex + columns < gridItems.length
          ? gridItems[currentIndex + columns]
          // Partial last row: drop to its last card rather than nowhere.
          : rowStart + columns < gridItems.length ? gridItems[gridItems.length - 1] : undefined)
        : currentIndex - columns >= 0 ? gridItems[currentIndex - columns] : undefined;
      if (target) {
        focusElement(target);
        return true;
      }
      if (direction === "down" && currentGrid.closest<HTMLElement>(".library-results")?.dataset.hasMore === "true") {
        window.dispatchEvent(new CustomEvent("silo:library-load-more", {
          detail: { loadedCount: gridItems.length, column: currentIndex % columns }
        }));
        return true;
      }
      if (direction === "up") {
        const controls = filters.length ? filters : toolbarItems;
        const above = controls[controls.length - 1]
          ?? navItems.find(item => item.getAttribute("aria-current") === "page") ?? navItems[0];
        if (above) focusElement(above);
        return true;
      }
      return true;
    }
    if (direction === "left" || direction === "right") {
      if (focusAdjacent(current, sameRow, direction)) return true;
      if (direction === "right" && jumpItems[0]) {
        const selected = jumpItems.find(item => item.classList.contains("selected")) ?? jumpItems[0];
        focusElement(selected);
        return true;
      }
      return true;
    }
    return true;
  }

  return false;
}

/** Columns of a CSS grid, read from its computed template (one style read, no per-card layout). */
function gridColumnCount(grid: HTMLElement) {
  const template = getComputedStyle(grid).gridTemplateColumns;
  const count = template && template !== "none" ? template.trim().split(/\s+/).length : 1;
  return Math.max(1, count);
}

export function installSpatialNavigation() {
  const pendingPress: { current: { element: HTMLElement; timer: number } | null } = { current: null };
  const onKeyDown = (event: KeyboardEvent) => {
    // The player owns the remote end to end (its key map is the Android TV
    // player's); spatial navigation would double-drive its scrubber and
    // transport focus.
    if (document.querySelector(".player-shell")) return;
    keyHeld = event.repeat;
    if (event.repeat && (event.key === "ArrowLeft" || event.key === "ArrowRight") && performance.now() < railStepUntil) {
      event.preventDefault();
      return;
    }
    const modal = document.querySelector<HTMLElement>('[data-modal="true"]');
    const modalDirection = directionKeys[event.key];
    if (modal && modalDirection && modal.classList.contains("home-sections-editor")) {
      const items = Array.from(modal.querySelectorAll<HTMLElement>("[data-tv-focusable='true']:not([disabled])")).filter(item => item.offsetParent !== null);
      const active = document.activeElement instanceof HTMLElement && items.includes(document.activeElement) ? document.activeElement : null;
      if (!active) {
        if (items[0]) focusElement(items[0]);
      } else {
        const card = active.closest(".home-sections-card");
        const sameCard = items.filter(item => item.closest(".home-sections-card") === card);
        let next: HTMLElement | undefined;
        if (modalDirection === "left" || modalDirection === "right") {
          const at = sameCard.indexOf(active);
          next = sameCard[at + (modalDirection === "right" ? 1 : -1)];
        } else {
          const cards = Array.from(modal.querySelectorAll<HTMLElement>(".home-sections-card"));
          const target = cards[cards.indexOf(card as HTMLElement) + (modalDirection === "down" ? 1 : -1)];
          const candidates = items.filter(item => item.closest(".home-sections-card") === target);
          const x = active.getBoundingClientRect().left;
          next = candidates.sort((l, r) => Math.abs(l.getBoundingClientRect().left - x) - Math.abs(r.getBoundingClientRect().left - x))[0];
        }
        if (next) focusElement(next);
      }
      event.preventDefault();
      return;
    }
    if (modal && modalDirection) {
      const rows = Array.from(modal.querySelectorAll<HTMLElement>("[data-tv-focusable='true']:not([disabled])"))
        .filter(item => item.offsetParent !== null);
      if (rows.length) {
        const active = document.activeElement instanceof HTMLElement && modal.contains(document.activeElement) ? document.activeElement : null;
        if (!active) {
          focusElement(rows[0]);
        } else {
          const center = (element: HTMLElement) => { const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; };
          const point = center(active);
          const candidates = rows.filter(row => row !== active).map(element => ({ element, point: center(element) }));
          const horizontal = modalDirection === "left" || modalDirection === "right";
          const next = candidates.filter(candidate => horizontal
            ? Math.abs(candidate.point.y - point.y) < Math.max(active.offsetHeight, candidate.element.offsetHeight) * 0.7 && (modalDirection === "right" ? candidate.point.x > point.x : candidate.point.x < point.x)
            : (modalDirection === "down" ? candidate.point.y > point.y : candidate.point.y < point.y))
            .sort((a, b) => horizontal
              ? Math.abs(a.point.x - point.x) - Math.abs(b.point.x - point.x)
              : Math.abs(a.point.y - point.y) * 1000 + Math.abs(a.point.x - point.x) - (Math.abs(b.point.y - point.y) * 1000 + Math.abs(b.point.x - point.x)))[0]?.element;
          if (next) focusElement(next);
        }
        event.preventDefault();
        return;
      }
    }


    const direction = directionKeys[event.key];
    if (event.key === "Enter" || event.key === "OK") {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && activeElement.matches("[data-tv-focusable='true']")) {
        event.preventDefault();
        if (!event.repeat) {
          if (activeElement.matches("[data-menu-context='true']")) {
            pendingPress.current = { element: activeElement, timer: window.setTimeout(() => {
              pendingPress.current = null;
              consumeEnterKeyUp = true;
              activeElement.dispatchEvent(new CustomEvent("silo:open-card-menu", { bubbles: true }));
            }, 500) };
          } else {
            consumeEnterKeyUp = true;
            activeElement.click();
          }
        }
      }
      return;
    }
    if (!direction) return;

    // Settings owns the arrows while it is open (Android TV: the rail and the
    // detail pane are their own focus scopes; Back, not Up, leaves them).
    const settings = document.querySelector<HTMLElement>(".settings-split");
    if (settings) {
      const rows = Array.from(settings.querySelectorAll<HTMLElement>("[data-tv-focusable='true']"))
        .filter(item => item.offsetParent !== null);
      const active = document.activeElement instanceof HTMLElement && settings.contains(document.activeElement)
        ? document.activeElement
        : null;
      if (!rows.length) return;
      if (!active) {
        focusElement(rows[0]);
        event.preventDefault();
        return;
      }
      const inPane = active.closest(".settings-pane") !== null;
      if (direction === "left" && inPane) {
        const railTarget = settings.querySelector<HTMLElement>(".settings-rail [aria-current='true']")
          ?? settings.querySelector<HTMLElement>(".settings-rail [data-tv-focusable='true']");
        railTarget?.focus();
        event.preventDefault();
        return;
      }
      if (direction === "right" && !inPane && active.closest(".settings-category")) {
        const paneRow = focusables(".settings-pane [data-tv-focusable='true']")[0];
        if (paneRow) focusElement(paneRow);
        event.preventDefault();
        return;
      }
      if (direction === "up" || direction === "down") {
        const column = rows.filter(row => (row.closest(".settings-pane") !== null) === inPane);
        focusAdjacent(active, column, direction); // At either end the focus stays put.
      }
      event.preventDefault();
      return;
    }

    const browsePanelOpen = document.querySelector(".browse-panel-scrim") !== null;
    const allFocusables = focusables(browsePanelOpen
      ? ".browse-panel-scrim [data-tv-focusable='true']"
      : "[data-tv-focusable='true']");
    if (!allFocusables.length) return;
    const current = document.activeElement instanceof HTMLElement && allFocusables.includes(document.activeElement)
      ? document.activeElement
      // With the sort or filter panel open, lost focus comes back into the panel, never to the grid behind it.
      : (browsePanelOpen ? undefined : focusables(".content-screen .media-card")[0]
        ?? focusables(".tv-nav [data-nav-primary][aria-current='page']")[0])
        ?? allFocusables[0];
    if (document.activeElement !== current) {
      focusElement(current);
      event.preventDefault();
      return;
    }

    if (current.closest(".browse-panel-scrim")) {
      if (current instanceof HTMLInputElement && (direction === "left" || direction === "right")) return;
      const from = current.getBoundingClientRect();
      const target = allFocusables
        .filter(candidate => candidate !== current)
        .map(candidate => ({ candidate, score: candidateScore(from, candidate.getBoundingClientRect(), direction) }))
        .sort((a, b) => a.score - b.score)[0];
      if (target && Number.isFinite(target.score)) focusElement(target.candidate);
      event.preventDefault();
      return;
    }

    // The profile picker's buttons (Manage, Change server, Sign out) are one row: Left and Right
    // stop at its ends instead of jumping up to a profile.
    const pickerActions = current.closest<HTMLElement>(".profile-selection-actions");
    if (pickerActions && (direction === "left" || direction === "right")) {
      focusAdjacent(current, allFocusables.filter(item => pickerActions.contains(item)), direction);
      event.preventDefault();
      return;
    }

    if (current.closest(".tv-nav") && navigateTopNav(current, direction)) {
      event.preventDefault();
      return;
    }

    if ((current.closest(".library-screen") || current.matches(".browse-dropdown-trigger, .browse-dropdown-option")) && navigateLibrary(current, direction)) {
      event.preventDefault();
      return;
    }

    const mediaRail = current.closest<HTMLElement>(".media-rail");
    if (mediaRail && (direction === "left" || direction === "right")) {
      // Sliding rows keep every card position in the DOM in order, so the neighbour is the
      // next position along. No need to measure every card on the screen.
      const wrap = current.closest<HTMLElement>(".media-card-wrap");
      if (wrap && current.closest<HTMLElement>(".rail-track")?.dataset.slide === "true") {
        const sibling = direction === "right" ? wrap.nextElementSibling : wrap.previousElementSibling;
        const next = sibling?.querySelector<HTMLElement>("[data-tv-focusable='true']:not([disabled])");
        if (next) focusElement(next);
        event.preventDefault();
        return;
      }
      const railCards = focusables(".media-card").filter(card => card.closest(".media-rail") === mediaRail);
      focusAdjacent(current, railCards, direction);
      event.preventDefault();
      return;
    }

    // Home rails: Up/Down always lands in the neighbouring rail (its first card), whatever the
    // sideways offset. Distance scoring skips sparse rows (wide Continue Watching cards) once the
    // middle lock has scrolled the focused card away from the left edge.
    if (mediaRail && mediaRail.closest(".home-rails") && (direction === "up" || direction === "down")) {
      const rails = Array.from(mediaRail.closest<HTMLElement>(".home-rails")!.querySelectorAll<HTMLElement>(".media-rail"))
        .filter(rail => rail.offsetParent !== null);
      const neighbour = rails[rails.indexOf(mediaRail) + (direction === "down" ? 1 : -1)];
      if (neighbour) {
        const firstCard = focusables(".media-card").find(card => neighbour.contains(card));
        if (firstCard) {
          focusElement(firstCard);
          event.preventDefault();
          return;
        }
      }
    }

    const detailRow = current.closest<HTMLElement>(".detail-cast-track, .detail-trailer-track, .episode-rail");
    if (detailRow && (direction === "left" || direction === "right")) {
      const rowItems = focusables("[data-tv-focusable='true']").filter(item => item.closest(".detail-cast-track, .detail-trailer-track, .episode-rail") === detailRow);
      const index = rowItems.indexOf(current);
      const forward = direction === "right";
      if (forward ? index === rowItems.length - 1 : index <= 0) {
        event.preventDefault();
        return;
      }
      focusAdjacent(current, rowItems, direction);
      event.preventDefault();
      return;
    }

    // The overview is a focus stop above the buttons (Android TV: Up from the action row).
    if (current.matches(".overview-button")) {
      const play = direction === "down"
        ? current.closest<HTMLElement>(".details-shell, .series-screen")?.querySelector<HTMLElement>(".details-actions .tv-button:not([disabled])")
        : null;
      if (play) focusElement(play);
      event.preventDefault();
      return;
    }
    const overview = current.closest(".details-actions") && direction === "up"
      ? current.closest<HTMLElement>(".details-shell, .series-screen")?.querySelector<HTMLElement>(".overview-button")
      : null;
    if (overview) {
      focusElement(overview);
      event.preventDefault();
      return;
    }

    if (current.closest(".details-actions") && direction === "down") {
      const screen = current.closest<HTMLElement>(".series-screen");
      const rail = screen?.querySelector<HTMLElement>(".episode-rail");
      const tab = screen?.querySelector<HTMLElement>(".season-tab.active") ?? screen?.querySelector<HTMLElement>(".season-tab");
      const next = tab ?? rail?.querySelector<HTMLElement>("[data-tv-focusable='true']");
      if (next) {
        focusElement(next);
        event.preventDefault();
        return;
      }
    }

    if (current.matches(".season-tab") && direction === "up") {
      const play = document.querySelector<HTMLElement>(".series-screen .details-actions .tv-button.series-play");
      if (play) {
        focusElement(play);
        event.preventDefault();
        return;
      }
    }

    if (current.matches(".season-tab") && direction === "down") {
      const rail = current.closest<HTMLElement>(".series-body")?.querySelector<HTMLElement>(".episode-rail");
      const lastId = current.closest<HTMLElement>(".series-screen")?.dataset.lastEpisode;
      const remembered = lastId ? rail?.querySelector<HTMLElement>(`[data-episode-id="${CSS.escape(lastId)}"]`) : null;
      const first = remembered ?? (rail ? focusables("[data-tv-focusable='true']").find(item => rail.contains(item) && item.offsetParent !== null) : undefined);
      if (first) {
        focusElement(first);
        event.preventDefault();
        return;
      }
    }

    // Up from the first row under the buttons goes back to Play (Android returnToHero, which
    // only the first body rail has). From a lower row it goes to the row above, below.
    const castRow = current.closest<HTMLElement>(".detail-cast-track, .detail-trailer-track, .rail-track");
    const detailScreen = current.closest<HTMLElement>(".details-shell, .series-screen");
    const bodyRows = detailScreen
      ? Array.from(detailScreen.querySelectorAll<HTMLElement>(".episode-rail, .detail-cast-track, .detail-trailer-track, .rail-track"))
        .filter(row => row.offsetParent !== null && row.querySelector("[data-tv-focusable='true']"))
      : [];
    if (castRow && direction === "up" && !current.closest(".series-body") && bodyRows.indexOf(castRow) > 0) {
      const target = rowEntry(bodyRows[bodyRows.indexOf(castRow) - 1]);
      if (target) {
        focusElement(target);
        event.preventDefault();
        return;
      }
    }
    if (castRow && direction === "up" && !current.closest(".series-body")) {
      const play = document.querySelector<HTMLElement>(".details-shell .details-actions .tv-button")
        ?? current.closest<HTMLElement>(".details-shell, .series-screen")?.querySelector<HTMLElement>(".details-actions .tv-button");
      if (play) {
        focusElement(play);
        event.preventDefault();
        return;
      }
    }

    const episodeRail = current.closest<HTMLElement>(".episode-rail");
    if (episodeRail && direction === "up") {
      const tab = document.querySelector<HTMLElement>(".series-body .season-tab.active")
        ?? document.querySelector<HTMLElement>(".series-body .season-tab");
      if (tab) {
        focusElement(tab);
        event.preventDefault();
        return;
      }
    }

    // Profile form fields: Left/Right stay in the text; Up/Down move between
    // fields by geometry (below) instead of jumping to the nav or a card.
    if (current instanceof HTMLInputElement && current.closest(".profile-form") && (direction === "left" || direction === "right")) return;
    if (current instanceof HTMLInputElement && current.type !== "button" && !current.closest(".profile-form")) {
      if (direction === "left" || direction === "right") return;
      if (direction === "down") {
        const firstCard = focusables(".content-screen .media-card, .content-screen .request-card, .content-screen .collection-card")[0];
        if (firstCard) focusElement(firstCard);
        event.preventDefault();
        return;
      }
      if (direction === "up") {
        const activeNav = focusables(".tv-nav [data-nav-primary][aria-current='page']")[0];
        if (activeNav) focusElement(activeNav);
        event.preventDefault();
        return;
      }
    }

    const leavingSeriesBody = current.closest(".series-body") && direction === "up";
    if (leavingSeriesBody) {
      const screen = current.closest<HTMLElement>(".series-screen");
      const rail = screen?.querySelector<HTMLElement>(".episode-rail");
      const sections = Array.from(current.closest<HTMLElement>(".series-body")?.querySelectorAll<HTMLElement>(".detail-section, .media-rail") ?? []);
      const firstSection = sections[0];
      if (direction === "up" && !current.closest(".episode-rail") && rail && (!firstSection || firstSection.contains(current))) {
        const lastId = screen?.dataset.lastEpisode;
        const card = lastId ? rail.querySelector<HTMLElement>(`[data-episode-id="${CSS.escape(lastId)}"]`) : undefined;
        if (card) {
          focusElement(card);
          event.preventDefault();
          return;
        }
      }
    }

    const from = current.getBoundingClientRect();
    const target = allFocusables
      .filter(candidate => candidate !== current)
      .map(candidate => ({ candidate, score: candidateScore(from, candidate.getBoundingClientRect(), direction) }))
      .sort((a, b) => a.score - b.score)[0];
    if (target && Number.isFinite(target.score)) {
      const targetRow = target.candidate.closest<HTMLElement>(".episode-rail, .detail-cast-track, .detail-trailer-track, .rail-track");
      if (targetRow && !targetRow.contains(current) && (direction === "up" || direction === "down")) {
        const firstInRow = targetRow.closest(".home-rails") ? focusables("[data-tv-focusable='true']").find(item => targetRow.contains(item) && item.offsetParent !== null) : rowEntry(targetRow);
        if (firstInRow) {
          focusElement(firstInRow);
          event.preventDefault();
          return;
        }
      }
      const activeNav = direction === "up" && target.candidate.closest(".tv-nav")
        ? focusables(".tv-nav [data-nav-primary][aria-current='page']")[0]
        : undefined;
      focusElement(activeNav ?? target.candidate);
      event.preventDefault();
      return;
    }
    if (current.closest(".home-rails")) event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if ((event.key === "Enter" || event.key === "OK") && pendingPress.current) {
      const pending = pendingPress.current;
      window.clearTimeout(pending.timer);
      pendingPress.current = null;
      consumeEnterKeyUp = true;
      pending.element.click();
      event.preventDefault();
      return;
    }
    if ((event.key === "Enter" || event.key === "OK") && consumeEnterKeyUp) {
      consumeEnterKeyUp = false;
      event.preventDefault();
    }
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  queueMicrotask(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active.isConnected) return;
    const target = focusables(".content-screen .media-card")[0]
      ?? focusables(".tv-nav [data-nav-primary][aria-current='page']")[0]
      ?? focusables("[data-tv-focusable='true']")[0];
    target?.focus({ preventScroll: true });
  });
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}
