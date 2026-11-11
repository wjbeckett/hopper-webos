import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { backdropUrl } from "../api/silo";
import { focusFirstContentCard, focusNavigationTarget } from "../navigation/spatial";
import { focusFromPointer } from "../navigation/pointer";
import { subscribeWatchState } from "../core/watchState";
import { HomeHero, warmBackdrop, type HomeHeroHandle } from "./HomeHero";
import { MediaRail } from "./MediaRail";
import type { HomeRail, Session, SiloItem } from "../types";

type Props = {
  rails: HomeRail[];
  session: Session;
  onOpen: (item: SiloItem) => void;
  /** Opens a row's full page; enables the trailing "Explore all" card. */
  onExplore?: (rail: HomeRail) => void;
  error?: string;
  emptyTitle: string;
  emptyDescription: string;
  emptyMark?: string;
  /**
   * Remember which card had focus under this key and return to it when the screen is shown
   * again with nothing focused (Back from a details page). Omit for no memory.
   */
  restoreKey?: string;
};

/** Last focused card per restoreKey: the row's id and the card's position in it. */
const rememberedFocus = new Map<string, { railId: string; index: number }>();

// The screen unmounts while a row's full page is open, so the row to return
// focus to lives at module level (Android arms an explore-all return the same
// way). Consumed once by the next mount that finds the row's Explore card.
let pendingExploreReturn: string | null = null;

/**
 * Only rows near the focused one render their cards; the rest keep their heading and
 * reserved height. A TV has little to spare for rows nobody can see: every mounted card
 * costs style, layout, compositing and image memory on each key press.
 *
 * NEEDED is what must exist the moment focus lands on a row: the rows on screen. IDLE is
 * the wider range mounted once the remote has been quiet, so the next press up or down
 * finds its row already built and the press itself mounts nothing. Rows stay built once
 * they are, up to MAX_LIVE_ROWS, so going back over them costs nothing either.
 */
const NEEDED_ABOVE = 1;
const NEEDED_BELOW = 2;
const IDLE_ABOVE = 2;
const IDLE_BELOW = 4;
const LIVE_IDLE_MS = 450;
const MAX_LIVE_ROWS = 9;

export function FeaturedRailsScreen({
  rails,
  session,
  onOpen,
  onExplore,
  error,
  emptyTitle,
  emptyDescription,
  emptyMark = "S",
  restoreKey
}: Props) {
  const heroRef = useRef<HomeHeroHandle>(null);
  const focusedCardRef = useRef<{ element: HTMLElement; railId: string; index: number } | undefined>(undefined);
  const restoredFocusRef = useRef(false);
  const mainRef = useRef<HTMLElement>(null);
  /** How far the band's inner block is translated up, in px. */
  const bandOffset = useRef(0);
  const lastWheel = useRef(0);
  // The card to put focus back on, worked out once on mount. Whether to use it is decided
  // after the first commit (see the effect below), when the previous screen has left the DOM.
  const [restore] = useState(() => {
    const remembered = restoreKey ? rememberedFocus.get(restoreKey) : undefined;
    if (!remembered) return undefined;
    const railIndex = rails.findIndex(rail => rail.id === remembered.railId);
    return railIndex >= 0 ? { ...remembered, railIndex } : undefined;
  });
  const restorePending = useRef(Boolean(restore));
  /** Rows that render their cards, by index (inclusive). */
  const [live, setLive] = useState(() => {
    const centre = restore?.railIndex ?? 0;
    return { from: centre - IDLE_ABOVE, to: centre + IDLE_BELOW };
  });
  const liveTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(liveTimer.current), []);

  function rowFocused(index: number) {
    // Grow at once if the rows on screen are not all live; never shrink during a key press.
    setLive(current => {
      const from = Math.min(current.from, index - NEEDED_ABOVE);
      const to = Math.max(current.to, index + NEEDED_BELOW);
      return from === current.from && to === current.to ? current : { from, to };
    });
    window.clearTimeout(liveTimer.current);
    liveTimer.current = window.setTimeout(() => {
      setLive(current => {
        // Grow towards the idle range and keep what is already built: taking rows down costs
        // as much as putting them up, and a row left alone is free to return to. Past
        // MAX_LIVE_ROWS, drop rows from the end farther from focus.
        let from = Math.min(current.from, index - IDLE_ABOVE);
        let to = Math.max(current.to, index + IDLE_BELOW);
        while (to - from + 1 > MAX_LIVE_ROWS) {
          if (index - from > to - index) from += 1;
          else to -= 1;
        }
        return from === current.from && to === current.to ? current : { from, to };
      });
    }, LIVE_IDLE_MS);
  }
  const [watchVersion, setWatchVersion] = useState(0);
  useEffect(() => subscribeWatchState(() => setWatchVersion(version => version + 1)), []);
  const displayRails = useMemo(() => rails.map(rail => {
    if (!rail.title.toLocaleLowerCase().includes("continue watching")) return rail;
    const kept = rail.items.filter(item => item.UserData?.Played !== true);
    return kept.length === rail.items.length ? rail : { ...rail, items: kept };
  }), [rails, watchVersion]);

  const itemsById = useMemo(
    () => new Map(displayRails.flatMap(rail => rail.items.map(item => [item.Id, item] as const))),
    [displayRails]
  );

  function warmNeighbours(card: HTMLElement) {
    const wrap = card.closest<HTMLElement>(".media-card-wrap");
    for (const sibling of [wrap?.nextElementSibling, wrap?.previousElementSibling]) {
      const id = sibling?.querySelector<HTMLElement>("[data-media-id]")?.dataset.mediaId;
      const neighbour = id ? itemsById.get(id) : undefined;
      if (neighbour) void warmBackdrop(backdropUrl(session, neighbour));
    }
  }

  // Rows gaining or losing their cards can change height above the focused row. Put the
  // focused row back at the top of the band, without animating.
  useLayoutEffect(() => {
    const card = focusedCardRef.current?.element;
    if (card?.isConnected && document.activeElement === card) keepFocusedRailInView(card, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // Back from a details page: return to the card that was focused, without animating there.
  useLayoutEffect(() => {
    if (!restorePending.current || !restore) return;
    restorePending.current = false;
    // Something else holds focus (the top navigation, when Home was chosen from it), or an
    // Explore return is pending: leave focus alone and build the rows from the top.
    const active = document.activeElement;
    const focusHeld = active instanceof HTMLElement && active !== document.body && active.isConnected;
    if (focusHeld || pendingExploreReturn) {
      setLive({ from: -IDLE_ABOVE, to: IDLE_BELOW });
      return;
    }
    const railElement = mainRef.current?.querySelectorAll<HTMLElement>(".media-rail")[restore.railIndex];
    const rail = displayRails[restore.railIndex];
    const slot = Math.min(restore.index, Math.max(0, (railElement?.querySelectorAll(".media-card-wrap").length ?? 1) - 1));
    const target = railElement?.querySelectorAll<HTMLElement>(".media-card-wrap")[slot]?.querySelector<HTMLElement>("[data-tv-focusable='true']");
    if (!railElement || !target) return;
    keepFocusedRailInView(target, false);
    const item = rail?.items[slot];
    restoredFocusRef.current = true;
    if (item) heroRef.current?.show(item, restore.railIndex);
    focusNavigationTarget(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from a row's full page: land on that row's "Explore all" card.
  useLayoutEffect(() => {
    if (!pendingExploreReturn || !displayRails.length) return;
    const railId = pendingExploreReturn;
    const card = Array.from(mainRef.current?.querySelectorAll<HTMLElement>("[data-explore-rail]") ?? [])
      .find(element => element.dataset.exploreRail === railId);
    pendingExploreReturn = null;
    if (!card) return;
    restoredFocusRef.current = true;
    focusNavigationTarget(card);
    keepFocusedRailInView(card);
  }, [displayRails]);

  useLayoutEffect(() => {
    const record = focusedCardRef.current;
    if (!record || record.element.isConnected) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.isConnected && active !== document.body) return;
    focusedCardRef.current = undefined;
    const railIndex = displayRails.findIndex(node => node.id === record.railId);
    const rail = railIndex >= 0 ? displayRails[railIndex] : undefined;
    const slot = rail ? Math.max(0, Math.min(record.index, rail.items.length - 1)) : -1;
    const item = rail?.items[slot];
    const railElement = rail
      ? mainRef.current?.querySelectorAll<HTMLElement>(".media-rail")[railIndex]
      : undefined;
    const target = item
      ? railElement?.querySelectorAll<HTMLElement>(".media-card-wrap")[slot]?.querySelector<HTMLElement>("[data-tv-focusable='true']")
      : undefined;
    if (item && target) {
      focusedCardRef.current = { element: target, railId: record.railId, index: slot };
      restoredFocusRef.current = true;
      heroRef.current?.show(item, railIndex);
      focusNavigationTarget(target);
      return;
    }
    focusFirstContentCard();
  }, [rails]);

  /**
   * Bring the focused row to the top of the band. The band does not scroll: its inner block
   * is translated, with a CSS transition, so the move is one style change and the compositor
   * animates it. Scrolling it from script cost a compositing update and a commit per frame.
   */
  function keepFocusedRailInView(card: HTMLElement, animate = true) {
    const rail = card.closest<HTMLElement>(".media-rail");
    const inner = rail?.parentElement;
    if (!rail || !inner || !inner.classList.contains("home-rails-inner") || !card.isConnected) return;
    const offset = Math.max(0, rail.offsetTop);
    if (bandOffset.current === offset) return;
    bandOffset.current = offset;
    if (!animate) inner.classList.add("no-slide");
    inner.style.transform = offset ? `translate3d(0, ${-offset}px, 0)` : "";
    if (!animate) {
      // Apply the jump before transitions are allowed again.
      void inner.offsetHeight;
      inner.classList.remove("no-slide");
    }
    heroRef.current?.syncScroll(offset);
  }


  const exploreRail = useCallback((target: HomeRail) => {
    pendingExploreReturn = target.id;
    onExplore?.(target);
  }, [onExplore]);

  return (
    <main
      ref={mainRef}
      className="content-screen home-screen"
      onFocusCapture={(event) => {
        const card = (event.target as HTMLElement).closest<HTMLElement>("[data-media-id]");
        const item = card?.dataset.mediaId ? itemsById.get(card.dataset.mediaId) : undefined;
        const focusable = (event.target as HTMLElement).closest<HTMLElement>("[data-tv-focusable='true']");
        const rail = focusable?.closest<HTMLElement>(".media-rail");
        const container = rail?.parentElement;
        const railIndex = rail && container
          ? Array.from(container.children).indexOf(rail)
          : -1;
        if (railIndex >= 0) rowFocused(railIndex);
        if (item && card && railIndex >= 0) {
          heroRef.current?.preview(item, railIndex);
          // Not for the pointer: moving the rows would put a different card under it.
          if (!focusFromPointer()) keepFocusedRailInView(card);
          warmNeighbours(card);
        }
        const wrap = card?.closest<HTMLElement>(".media-card-wrap");
        const slot = wrap?.parentElement ? Array.from(wrap.parentElement.children).indexOf(wrap) : -1;
        const railId = rail?.dataset.railId;
        if (card && railId && slot >= 0) {
          focusedCardRef.current = { element: card, railId, index: slot };
          if (restoreKey) rememberedFocus.set(restoreKey, { railId, index: slot });
        }
      }}
    >
      <HomeHero
        ref={heroRef}
        rails={displayRails}
        session={session}
        skipInitial={() => {
          if (!restoredFocusRef.current) return false;
          restoredFocusRef.current = false;
          return true;
        }}
      />
      {error ? <div className="error">{error}</div> : null}
      <div
        className="home-rails"
        onWheel={event => {
          // The band has no scrollbar to drive, so a pointer wheel moves focus a row at a time.
          const now = performance.now();
          if (Math.abs(event.deltaY) < 4 || now - lastWheel.current < 220) return;
          lastWheel.current = now;
          const key = event.deltaY > 0 ? "ArrowDown" : "ArrowUp";
          const from = document.activeElement instanceof HTMLElement && event.currentTarget.contains(document.activeElement)
            ? document.activeElement
            : event.currentTarget.querySelector<HTMLElement>(".media-card");
          from?.focus({ preventScroll: true });
          from?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        }}
      >
        <div className="home-rails-inner">
        {displayRails.map((rail, index) => (
          <MediaRail
            key={rail.id}
            rail={rail}
            session={session}
            onOpen={onOpen}
            onExplore={onExplore ? exploreRail : undefined}
            live={index >= live.from && index <= live.to}
            initialAnchor={restore && restore.railIndex === index ? restore.index : 0}
            slide
          />
        ))}
        </div>
        {!displayRails.length && !error ? (
          <div className="empty-state">
            <span className="empty-state-mark" aria-hidden="true">{emptyMark}</span>
            <h2>{emptyTitle}</h2>
            <p>{emptyDescription}</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
