type Direction = "left" | "right" | "up" | "down";

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

function candidateScore(from: DOMRect, to: DOMRect, direction: Direction) {
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

function focusElement(element: HTMLElement) {
  element.focus({ preventScroll: true });
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
    if (delta) libraryResults.scrollBy({ top: delta, behavior: "smooth" });

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
  if (element.closest(".tv-nav")) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.querySelector<HTMLElement>(".library-results")?.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (element.closest(".library-screen")) return;
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

  const firstCard = focusables(".content-screen .media-card")[0];
  const firstContentControl = focusables(".content-screen [data-tv-focusable='true']")[0];
  const target = firstCard ?? firstContentControl;
  if (target) focusElement(target);
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
    ? Array.from(currentGrid.querySelectorAll<HTMLElement>(":scope > [data-tv-focusable='true']"))
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
    if (direction === "up" && toolbarItems.length) {
      focusElement(toolbarItems[toolbarItems.length - 1]);
      return true;
    }
    if (direction === "down" && gridItems[0]) {
      focusElement(gridItems[0]);
      return true;
    }
    return true;
  }

  if (current.matches(".library-alpha-nav [data-tv-focusable='true']")) {
    if (direction === "up" || direction === "down") {
      focusAdjacent(current, jumpItems, direction);
      return true;
    }
    if (direction === "left") {
      const jumpGrid = document.querySelector<HTMLElement>(".library-results .library-grid");
      const jumpGridItems = jumpGrid
        ? Array.from(jumpGrid.querySelectorAll<HTMLElement>(":scope > [data-tv-focusable='true']"))
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

  if (currentGrid && gridItems.includes(current)) {
    const sameRow = gridItems.filter(item => item.offsetTop === current.offsetTop);
    if (direction === "left" || direction === "right") {
      if (focusAdjacent(current, sameRow, direction)) return true;
      if (direction === "right" && jumpItems[0]) {
        focusElement(jumpItems[0]);
        return true;
      }
      return true;
    }

    const rowTops = Array.from(new Set(gridItems.map(item => item.offsetTop))).sort((a, b) => a - b);
    const rowIndex = rowTops.indexOf(current.offsetTop);
    const targetRow = rowTops[rowIndex + (direction === "down" ? 1 : -1)];
    if (targetRow !== undefined) {
      const currentX = center(current.getBoundingClientRect()).x;
      const target = gridItems
        .filter(item => item.offsetTop === targetRow)
        .sort((a, b) => Math.abs(center(a.getBoundingClientRect()).x - currentX) - Math.abs(center(b.getBoundingClientRect()).x - currentX))[0];
      if (target) {
        focusElement(target);
        return true;
      }
    } else if (direction === "down" && currentGrid.closest<HTMLElement>(".library-results")?.dataset.hasMore === "true") {
      const firstRowTop = rowTops[0];
      const columnCount = gridItems.filter(item => item.offsetTop === firstRowTop).length;
      window.dispatchEvent(new CustomEvent("silo:library-load-more", {
        detail: { loadedCount: gridItems.length, column: gridItems.indexOf(current) % Math.max(1, columnCount) }
      }));
    } else if (direction === "up" && rowIndex === 0) {
      const controls = filters.length ? filters : toolbarItems;
      if (controls.length) {
        focusElement(controls[controls.length - 1]);
        return true;
      }
      if (navItems.length) {
        focusElement(navItems.find(item => item.getAttribute("aria-current") === "page") ?? navItems[0]);
        return true;
      }
    }
    return true;
  }

  return false;
}

export function installSpatialNavigation() {
  const pendingPress: { current: { element: HTMLElement; timer: number } | null } = { current: null };
  const onKeyDown = (event: KeyboardEvent) => {
    const direction = directionKeys[event.key];
    if (event.key === "Enter" || event.key === "OK") {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && activeElement.matches("[data-tv-focusable='true']")) {
        event.preventDefault();
        if (!event.repeat) {
          if (activeElement.matches("[data-menu-context='true']")) {
            // Hold-to-menu: keydown arms the long-press timer; keyup inside the
            // window activates the card, keyup after the menu opened is swallowed.
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

    const modal = document.querySelector<HTMLElement>('[data-modal="true"]');
    if (modal) {
      const rows = Array.from(modal.querySelectorAll<HTMLElement>("[data-tv-focusable='true']"))
        .filter(item => item.offsetParent !== null);
      if (rows.length) {
        const active = document.activeElement instanceof HTMLElement && modal.contains(document.activeElement) ? document.activeElement : null;
        if (!active) {
          focusElement(rows[0]);
        } else {
          const index = rows.indexOf(active);
          const next = direction === "down" ? rows[index + 1] : direction === "up" ? rows[index - 1] : undefined;
          if (next) focusElement(next);
        }
        event.preventDefault();
        return;
      }
    }

    const browsePanelOpen = document.querySelector(".browse-panel-scrim") !== null;
    const allFocusables = focusables(browsePanelOpen
      ? ".browse-panel-scrim [data-tv-focusable='true']"
      : "[data-tv-focusable='true']");
    if (!allFocusables.length) return;
    const current = document.activeElement instanceof HTMLElement && allFocusables.includes(document.activeElement)
      ? document.activeElement
      : focusables(".content-screen .media-card")[0]
        ?? focusables(".tv-nav [data-nav-primary][aria-current='page']")[0]
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
      const railCards = focusables(".media-card").filter(card => card.closest(".media-rail") === mediaRail);
      focusAdjacent(current, railCards, direction);
      event.preventDefault();
      return;
    }

    if (current instanceof HTMLInputElement && current.type !== "button") {
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

    const from = current.getBoundingClientRect();
    const target = allFocusables
      .filter(candidate => candidate !== current)
      .map(candidate => ({ candidate, score: candidateScore(from, candidate.getBoundingClientRect(), direction) }))
      .sort((a, b) => a.score - b.score)[0];
    if (target && Number.isFinite(target.score)) {
      const activeNav = direction === "up" && target.candidate.closest(".tv-nav")
        ? focusables(".tv-nav [data-nav-primary][aria-current='page']")[0]
        : undefined;
      focusElement(activeNav ?? target.candidate);
      event.preventDefault();
    }
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
