type Direction = "left" | "right" | "up" | "down";

const directionKeys: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down"
};

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

  const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
  const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);

  return primary + cross * 2.2;
}

export function installSpatialNavigation() {
  const onKeyDown = (event: KeyboardEvent) => {
    const direction = directionKeys[event.key];

    if (event.key === "Enter") {
      const active = document.activeElement as HTMLElement | null;
      active?.click?.();
      return;
    }

    if (!direction) return;

    const focusables = Array.from(
      document.querySelectorAll<HTMLElement>("[data-tv-focusable='true']:not([disabled])")
    ).filter((el) => el.offsetParent !== null);

    if (!focusables.length) return;

    const current =
      document.activeElement instanceof HTMLElement &&
      focusables.includes(document.activeElement)
        ? document.activeElement
        : focusables[0];

    if (document.activeElement !== current) {
      current.focus();
      event.preventDefault();
      return;
    }

    const currentRect = current.getBoundingClientRect();

    const best = focusables
      .filter((candidate) => candidate !== current)
      .map((candidate) => ({
        candidate,
        score: candidateScore(currentRect, candidate.getBoundingClientRect(), direction)
      }))
      .sort((a, b) => a.score - b.score)[0];

    if (best && Number.isFinite(best.score)) {
      best.candidate.focus();
      event.preventDefault();
    }
  };

  window.addEventListener("keydown", onKeyDown);

  queueMicrotask(() => {
    const first = document.querySelector<HTMLElement>("[data-tv-focusable='true']");
    first?.focus();
  });

  return () => window.removeEventListener("keydown", onKeyDown);
}
