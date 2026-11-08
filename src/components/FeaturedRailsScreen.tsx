import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { UIEvent } from "react";
import { backdropUrl, mediaLogoUrl } from "../api/silo";
import { focusFirstContentCard, focusNavigationTarget } from "../navigation/spatial";
import { subscribeWatchState } from "../core/watchState";
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
};

const ambientTintCache = new Map<string, string | null>();

// The screen unmounts while a row's full page is open, so the row to return
// focus to lives at module level (Android arms an explore-all return the same
// way). Consumed once by the next mount that finds the row's Explore card.
let pendingExploreReturn: string | null = null;

function sampleAmbientTint(url: string): Promise<string | null> {
  if (ambientTintCache.has(url)) return Promise.resolve(ambientTintCache.get(url) ?? null);
  // TV: a second CORS fetch, a canvas decode and a pixel read per backdrop cost more than the tint adds.
  if (/Web0S|webOS/i.test(navigator.userAgent)) return Promise.resolve(null);

  return new Promise(resolve => {
    const cacheFailure = (message: string) => {
      ambientTintCache.set(url, null);
      console.warn(message);
      resolve(null);
    };
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 36;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          cacheFailure("Home backdrop tint unavailable: canvas context could not be created.");
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] === 0) continue;
          red += pixels[index];
          green += pixels[index + 1];
          blue += pixels[index + 2];
          count++;
        }
        if (!count) {
          cacheFailure("Home backdrop tint unavailable: canvas contained no readable pixels.");
          return;
        }

        red /= count * 255;
        green /= count * 255;
        blue /= count * 255;
        const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        const scale = luminance <= 0.001
          ? 0
          : luminance > 0.22
            ? 0.22 / luminance
            : Math.max(1, 0.22 / Math.max(luminance, 0.05));
        const tint = [
          red,
          green,
          blue
        ].map(channel => Math.round(Math.max(0, Math.min(1, channel * scale)) * 255)).join(", ");
        ambientTintCache.set(url, tint);
        if (ambientTintCache.size > 256) {
          const oldest = ambientTintCache.keys().next().value;
          if (oldest) ambientTintCache.delete(oldest);
        }
        resolve(tint);
      } catch {
        cacheFailure("Home backdrop tint unavailable: canvas sampling failed.");
      }
    };
    image.onerror = () => cacheFailure("Home backdrop tint unavailable: cross-origin image load failed.");
    image.src = url;
  });
}

const warmBackdrops = new Map<string, HTMLImageElement>();

/** LG webOS TV panels: decode, raster and composite budget is far below a desktop browser. */
const isTv = () => /Web0S|webOS/i.test(navigator.userAgent);

/**
 * TV only (Plex-style): the hero backdrop waits until focus has rested this long,
 * while the title/logo copy still follows focus immediately. Rapid scrolling then
 * never decodes or paints a backdrop it is about to leave.
 */
const TV_BACKDROP_SETTLE_MS = 450;

function warmBackdrop(url: string) {
  if (!url || warmBackdrops.has(url) || isTv()) return Promise.resolve();
  const image = new Image();
  image.decoding = "async";
  warmBackdrops.set(url, image);
  image.src = url;
  return image.decode().catch(() => { warmBackdrops.delete(url); });
}

export function FeaturedRailsScreen({
  rails,
  session,
  onOpen,
  onExplore,
  error,
  emptyTitle,
  emptyDescription,
  emptyMark = "S"
}: Props) {
  const [heroImage, setHeroImage] = useState("");
  const [focusedItem, setFocusedItem] = useState<SiloItem>();
  const [previousFocusedItem, setPreviousFocusedItem] = useState<SiloItem>();
  const [marqueeDirection, setMarqueeDirection] = useState<"up" | "down" | "fade">("down");
  const [failedLogoFor, setFailedLogoFor] = useState<string>();
  const [loadedLogoFor, setLoadedLogoFor] = useState<string>();
  const [previousHeroImage, setPreviousHeroImage] = useState("");
  const [loadedHeroImage, setLoadedHeroImage] = useState("");
  const [failedHeroImage, setFailedHeroImage] = useState("");
  const [ambientTint, setAmbientTint] = useState("");
  const [previousAmbientTint, setPreviousAmbientTint] = useState("");
  const [loadedAmbientTint, setLoadedAmbientTint] = useState("");
  const heroTimer = useRef<number | undefined>(undefined);
  const focusTimer = useRef<number | undefined>(undefined);
  const marqueeTimer = useRef<number | undefined>(undefined);
  const ambientTintTimer = useRef<number | undefined>(undefined);
  const backdropTimer = useRef<number | undefined>(undefined);
  const [backdropSettling, setBackdropSettling] = useState(false);
  const focusedItemRef = useRef<SiloItem | undefined>(undefined);
  const focusedRailIndexRef = useRef<number | undefined>(undefined);
  const focusedCardRef = useRef<{ element: HTMLElement; railId: string; index: number } | undefined>(undefined);
  const restoredFocusRef = useRef(false);
  const mainRef = useRef<HTMLElement>(null);
  const heroImageRef = useRef("");
  const backdropRef = useRef<HTMLDivElement>(null);
  const lastHeroSwapAt = useRef(0);
  const [watchVersion, setWatchVersion] = useState(0);
  useEffect(() => subscribeWatchState(() => setWatchVersion(version => version + 1)), []);
  const displayRails = useMemo(() => rails.map(rail => {
    if (!rail.title.toLocaleLowerCase().includes("continue watching")) return rail;
    const kept = rail.items.filter(item => item.UserData?.Played !== true);
    return kept.length === rail.items.length ? rail : { ...rail, items: kept };
  }), [rails, watchVersion]);
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    const depth = Math.max(0, ...displayRails.map(rail => rail.items.length));
    for (let index = 0; index < Math.min(depth, 12); index += 1) {
      for (const rail of displayRails) {
        const item = rail.items[index];
        const url = item ? backdropUrl(session, item) : "";
        if (url && !urls.includes(url)) urls.push(url);
      }
    }
    (async () => {
      for (let start = 0; start < urls.length && !cancelled; start += 3) {
        await Promise.all(urls.slice(start, start + 3).map(warmBackdrop));
      }
    })();
    return () => { cancelled = true; };
  }, [displayRails, session]);

  const itemsById = new Map(displayRails.flatMap(rail => rail.items.map(item => [item.Id, item] as const)));

  function showHero(item: SiloItem, railIndex: number) {
    const previousItem = focusedItemRef.current;
    const previousRailIndex = focusedRailIndexRef.current;
    if (previousItem && (previousItem.Id !== item.Id || previousRailIndex !== railIndex)) {
      const direction = previousRailIndex !== undefined && railIndex !== previousRailIndex
        ? railIndex > previousRailIndex ? "down" : "up"
        : "fade";
      if (marqueeTimer.current !== undefined) window.clearTimeout(marqueeTimer.current);
      setPreviousFocusedItem(previousItem);
      setMarqueeDirection(direction);
      marqueeTimer.current = window.setTimeout(() => {
        setPreviousFocusedItem(undefined);
        marqueeTimer.current = undefined;
      }, 420);
    }
    focusedItemRef.current = item;
    focusedRailIndexRef.current = railIndex;
    lastHeroSwapAt.current = performance.now();
    setFocusedItem(item);
    const nextImage = backdropUrl(session, item);
    if (backdropTimer.current !== undefined) window.clearTimeout(backdropTimer.current);
    backdropTimer.current = undefined;
    if (!nextImage || nextImage === heroImageRef.current) {
      setBackdropSettling(false);
      return;
    }
    // First backdrop shows at once; later ones wait for focus to settle on a TV.
    if (heroImageRef.current && isTv()) {
      setBackdropSettling(true);
      backdropTimer.current = window.setTimeout(() => {
        backdropTimer.current = undefined;
        setBackdropSettling(false);
        applyHeroImage(nextImage);
      }, TV_BACKDROP_SETTLE_MS);
      return;
    }
    applyHeroImage(nextImage);
  }

  function applyHeroImage(nextImage: string) {
    // TV: the outgoing backdrop is hidden at once while focus moves, so no "previous" layer lingers.
    if (heroImageRef.current && !isTv()) {
      if (heroTimer.current !== undefined) window.clearTimeout(heroTimer.current);
      setPreviousHeroImage(heroImageRef.current);
      if (ambientTintTimer.current !== undefined) window.clearTimeout(ambientTintTimer.current);
      ambientTintTimer.current = undefined;
      setPreviousAmbientTint(ambientTint);
    }
    heroImageRef.current = nextImage;
    setLoadedHeroImage(warmBackdrops.has(nextImage) && warmBackdrops.get(nextImage)?.complete ? nextImage : "");
    setFailedHeroImage("");
    setLoadedAmbientTint("");
    setHeroImage(nextImage);
  }

  function warmNeighbours(card: HTMLElement) {
    const wrap = card.closest<HTMLElement>(".media-card-wrap");
    for (const sibling of [wrap?.nextElementSibling, wrap?.previousElementSibling]) {
      const id = sibling?.querySelector<HTMLElement>("[data-media-id]")?.dataset.mediaId;
      const neighbour = id ? itemsById.get(id) : undefined;
      if (neighbour) void warmBackdrop(backdropUrl(session, neighbour));
    }
  }

  function previewFocusedItem(item: SiloItem, railIndex: number) {
    if (focusTimer.current !== undefined) window.clearTimeout(focusTimer.current);
    focusTimer.current = undefined;
    if (focusedRailIndexRef.current !== railIndex) {
      showHero(item, railIndex);
      return;
    }
    const wait = Math.max(0, lastHeroSwapAt.current + 340 - performance.now());
    if (wait === 0) {
      showHero(item, railIndex);
      return;
    }
    focusTimer.current = window.setTimeout(() => {
      showHero(item, railIndex);
      focusTimer.current = undefined;
    }, wait);
  }

  useEffect(() => {
    if (restoredFocusRef.current) {
      restoredFocusRef.current = false;
      return;
    }
    const firstItem = displayRails[0]?.items[0];
    if (firstItem && (!focusedItem || !itemsById.has(focusedItem.Id))) showHero(firstItem, 0);
  }, [displayRails, session, focusedItem]);

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
      showHero(item, railIndex);
      focusNavigationTarget(target);
      return;
    }
    focusFirstContentCard();
  }, [rails]);

  useEffect(() => () => {
    if (heroTimer.current !== undefined) window.clearTimeout(heroTimer.current);
    if (focusTimer.current !== undefined) window.clearTimeout(focusTimer.current);
    if (marqueeTimer.current !== undefined) window.clearTimeout(marqueeTimer.current);
    if (ambientTintTimer.current !== undefined) window.clearTimeout(ambientTintTimer.current);
    if (backdropTimer.current !== undefined) window.clearTimeout(backdropTimer.current);
  }, []);

  function syncBackdropScroll(event: UIEvent<HTMLDivElement>) {
    const scrollTop = event.currentTarget.scrollTop;
    const offset = Math.max(-180, scrollTop * -0.22);
    backdropRef.current?.style.setProperty("--home-backdrop-offset", `${offset}px`);
  }

  function finishBackdropTransition() {
    if (heroTimer.current !== undefined) window.clearTimeout(heroTimer.current);
    heroTimer.current = window.setTimeout(() => {
      setPreviousHeroImage("");
      heroTimer.current = undefined;
    }, 360);
  }

  function keepFocusedRailInView(card: HTMLElement) {
    const rail = card.closest<HTMLElement>(".media-rail");
    const container = card.closest<HTMLElement>(".home-rails");
    if (!rail || !container) return;

    if (!card.isConnected) return;
    const containerRect = container.getBoundingClientRect();
    const railRect = rail.getBoundingClientRect();
    const topPadding = Number.parseFloat(getComputedStyle(container).paddingTop) || 0;
    const railOffset = container.scrollTop + railRect.top - containerRect.top - topPadding;
    if (Math.abs(railOffset - container.scrollTop) < 2) return;
    container.scrollTo({ top: Math.max(0, railOffset), behavior: "smooth" });
  }

  return (
    <main
      ref={mainRef}
      className="content-screen home-screen"
      onFocusCapture={(event) => {
        const card = (event.target as HTMLElement).closest<HTMLElement>("[data-media-id]");
        const item = card?.dataset.mediaId ? itemsById.get(card.dataset.mediaId) : undefined;
        const rail = card?.closest<HTMLElement>(".media-rail");
        const container = rail?.parentElement;
        const railIndex = rail && container
          ? Array.from(container.children).indexOf(rail)
          : -1;
        if (item && card && railIndex >= 0) {
          previewFocusedItem(item, railIndex);
          keepFocusedRailInView(card);
          warmNeighbours(card);
        }
        const wrap = card?.closest<HTMLElement>(".media-card-wrap");
        const track = card?.closest<HTMLElement>(".rail-track");
        const slot = wrap && track ? Array.from(track.children).indexOf(wrap) : -1;
        const railId = rail?.dataset.railId;
        if (card && railId && slot >= 0) focusedCardRef.current = { element: card, railId, index: slot };
      }}
    >
      <div ref={backdropRef} className={`home-hero-backdrop ${backdropSettling ? "settling" : ""}`} aria-hidden="true">
        {previousHeroImage ? (
          <>
            <img
              className={`home-backdrop-image previous direction-${marqueeDirection} ${loadedHeroImage === heroImage ? "transitioning-out" : ""}`}
              src={previousHeroImage}
              alt=""
            />
            <div
              className={`home-backdrop-wash previous direction-${marqueeDirection} ${loadedHeroImage === heroImage ? "transitioning-out" : ""}`}
              style={{ backgroundImage: `url("${previousHeroImage}")` }}
            />
          </>
        ) : null}
        {heroImage && failedHeroImage !== heroImage ? (
          <>
            <img
              className={`home-backdrop-image current direction-${marqueeDirection} ${loadedHeroImage === heroImage ? "loaded" : ""}`}
              key={heroImage}
              src={heroImage}
              alt=""
              onLoad={() => {
                setLoadedHeroImage(heroImage);
                finishBackdropTransition();
                void sampleAmbientTint(heroImage).then(tint => {
                  if (heroImageRef.current !== heroImage) return;
                  setAmbientTint(tint ?? "");
                  setLoadedAmbientTint(heroImage);
                  if (ambientTintTimer.current !== undefined) window.clearTimeout(ambientTintTimer.current);
                  ambientTintTimer.current = window.setTimeout(() => {
                    setPreviousAmbientTint("");
                    ambientTintTimer.current = undefined;
                  }, 320);
                });
              }}
              onError={() => {
                setFailedHeroImage(heroImage);
                setLoadedHeroImage(heroImage);
                setAmbientTint("");
                setLoadedAmbientTint(heroImage);
                if (ambientTintTimer.current !== undefined) window.clearTimeout(ambientTintTimer.current);
                ambientTintTimer.current = window.setTimeout(() => {
                  setPreviousAmbientTint("");
                  ambientTintTimer.current = undefined;
                }, 320);
                finishBackdropTransition();
              }}
            />
            <div
              className={`home-backdrop-wash current direction-${marqueeDirection} ${loadedHeroImage === heroImage ? "loaded" : ""}`}
              key={`wash-${heroImage}`}
              style={{ backgroundImage: `url("${heroImage}")` }}
            />
          </>
        ) : null}
        {previousAmbientTint ? (
          <div
            className={`home-backdrop-tint previous ${loadedAmbientTint === heroImage ? "transitioning-out" : ""}`}
            style={{ backgroundImage: ambientTintGradient(previousAmbientTint) }}
          />
        ) : null}
        {ambientTint ? (
          <div
            className={`home-backdrop-tint current ${loadedAmbientTint === heroImage ? "loaded" : ""}`}
            style={{ backgroundImage: ambientTintGradient(ambientTint) }}
          />
        ) : null}
        <div className="home-backdrop-scrim" />
        <div className="home-backdrop-vignette" />
      </div>
      {focusedItem ? (
        <section className="home-featured" aria-live="off" aria-label={`${focusedItem.Name} details`}>
          {previousFocusedItem ? (
            <FeaturedCopy
              key={`previous-${previousFocusedItem.Id}`}
              item={previousFocusedItem}
              session={session}
              failedLogoFor={failedLogoFor}
              loadedLogoFor={loadedLogoFor}
              className={`previous direction-${marqueeDirection}`}
            />
          ) : null}
          <FeaturedCopy
            key={`current-${focusedItem.Id}`}
            item={focusedItem}
            session={session}
            failedLogoFor={failedLogoFor}
            loadedLogoFor={loadedLogoFor}
            className={previousFocusedItem ? `current rolling direction-${marqueeDirection}` : "current"}
            onLogoLoad={() => setLoadedLogoFor(focusedItem.Id)}
            onLogoError={() => setFailedLogoFor(focusedItem.Id)}
          />
        </section>
      ) : null}
      {error ? <div className="error">{error}</div> : null}
      <div className="home-rails" onScroll={syncBackdropScroll}>
        {displayRails.map(rail => (
          <MediaRail
            key={rail.id}
            rail={rail}
            session={session}
            onOpen={onOpen}
            onExplore={onExplore ? target => { pendingExploreReturn = target.id; onExplore(target); } : undefined}
          />
        ))}
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

function ambientTintGradient(tint: string) {
  return `linear-gradient(to bottom left, rgba(${tint}, 1) 0%, rgba(${tint}, .5) 50%, rgba(${tint}, .18) 100%)`;
}

function FeaturedCopy({
  item,
  session,
  failedLogoFor,
  loadedLogoFor,
  className,
  onLogoLoad,
  onLogoError
}: {
  item: SiloItem;
  session: Session;
  failedLogoFor?: string;
  loadedLogoFor?: string;
  className: string;
  onLogoLoad?: () => void;
  onLogoError?: () => void;
}) {
  // TV (like Plex): a plain text title. No logo fetch or decode per focus change.
  const logo = isTv() ? "" : mediaLogoUrl(session, item);
  const hasLogo = Boolean(logo && failedLogoFor !== item.Id);
  const isEpisode = item.Type?.toLowerCase() === "episode";
  const title = isEpisode ? item.SeriesName ?? item.Name : item.Name;
  const genre = item.Genres?.find(value => value.trim());

  return (
    <div className={`home-featured-copy ${className}`} aria-hidden={className.includes("previous")}>
      <div className={`home-featured-heading ${hasLogo ? "has-logo" : ""}`}>
        {hasLogo ? (
          <>
            <h1 className="home-featured-title fallback-hidden">
              {title}
            </h1>
            <img
              className={`home-featured-logo ${loadedLogoFor === item.Id ? "loaded" : ""}`}
              src={logo}
              alt={title}
              onLoad={onLogoLoad}
              onError={onLogoError}
            />
          </>
        ) : <h1 className="home-featured-title">{title}</h1>}
      </div>
      <div className="home-featured-metadata">
        {item.ContentRating ? <span className="home-featured-rating">{item.ContentRating.toUpperCase()}</span> : null}
        {isEpisode ? (
          <>
            {item.ParentIndexNumber != null && item.IndexNumber != null
              ? <span>S{String(item.ParentIndexNumber).padStart(2, "0")} · E{String(item.IndexNumber).padStart(2, "0")}</span>
              : null}
            {item.Name !== item.SeriesName ? <span>{item.Name}</span> : null}
          </>
        ) : (
          <>
            {item.ProductionYear ? <span>{item.ProductionYear}</span> : null}
            {item.RuntimeMinutes && item.RuntimeMinutes > 0
              ? <span>{Math.floor(item.RuntimeMinutes / 60)}h {item.RuntimeMinutes % 60}m</span>
              : null}
            {item.ImdbRating ? <span>IMDb {item.ImdbRating.toFixed(1)}</span> : null}
            {item.TmdbRating && !item.ImdbRating ? <span>TMDB {item.TmdbRating.toFixed(1)}</span> : null}
            {genre ? <span>{genre}</span> : null}
          </>
        )}
      </div>
      {item.Overview ? <p className="home-featured-overview">{item.Overview}</p> : null}
    </div>
  );
}
