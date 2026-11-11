import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { backdropUrl, mediaLogoUrl } from "../api/silo";
import { isResumable, ResumeProgress } from "./ResumeProgress";
import type { HomeRail, Session, SiloItem } from "../types";

const ambientTintCache = new Map<string, string | null>();

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

/** Desktop only: decode a backdrop ahead of time so the swap is instant. */
export function warmBackdrop(url: string) {
  if (!url || warmBackdrops.has(url) || isTv()) return Promise.resolve();
  const image = new Image();
  image.decoding = "async";
  warmBackdrops.set(url, image);
  image.src = url;
  return image.decode().catch(() => { warmBackdrops.delete(url); });
}

export type HomeHeroHandle = {
  /** Focus moved to `item`: update the hero, debounced within a row. */
  preview: (item: SiloItem, railIndex: number) => void;
  /** Show `item` now. */
  show: (item: SiloItem, railIndex: number) => void;
  /** The rails scrolled: shift the backdrop with them (desktop parallax). */
  syncScroll: (scrollTop: number) => void;
};

type Props = {
  rails: HomeRail[];
  session: Session;
  /** Set while the screen restores focus itself, so the hero does not jump to the first item. */
  skipInitial?: () => boolean;
};

/**
 * The Home hero: backdrop artwork and the focused item's title, metadata and overview.
 *
 * It owns its own state and is driven through a ref, so a focus change re-renders the hero
 * only. The rails, which are most of the screen, do not re-render when focus moves.
 */
export const HomeHero = forwardRef<HomeHeroHandle, Props>(function HomeHero({ rails, session, skipInitial }, ref) {
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
  const focusedItemRef = useRef<SiloItem | undefined>(undefined);
  const focusedRailIndexRef = useRef<number | undefined>(undefined);
  const heroImageRef = useRef("");
  const backdropRef = useRef<HTMLDivElement>(null);
  const tvBackdropRef = useRef<TvBackdropHandle>(null);
  const lastHeroSwapAt = useRef(0);
  const tv = isTv();

  useEffect(() => {
    if (tv) return;
    let cancelled = false;
    const urls: string[] = [];
    const depth = Math.max(0, ...rails.map(rail => rail.items.length));
    for (let index = 0; index < Math.min(depth, 12); index += 1) {
      for (const rail of rails) {
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
  }, [rails, session, tv]);

  function showHero(item: SiloItem, railIndex: number) {
    const previousItem = focusedItemRef.current;
    const previousRailIndex = focusedRailIndexRef.current;
    // TV: swap the hero copy in place; mounting and animating an outgoing copy per focus change costs frames.
    if (!tv && previousItem && (previousItem.Id !== item.Id || previousRailIndex !== railIndex)) {
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
    if (tv) {
      // TV: the backdrop is two fixed layers driven outside React (see TvBackdrop). The first
      // one shows at once; later ones wait for focus to settle, and the old one fades out meanwhile.
      const first = !heroImageRef.current;
      heroImageRef.current = nextImage;
      if (first) {
        tvBackdropRef.current?.show(nextImage);
        return;
      }
      if (tvBackdropRef.current?.showing() === nextImage) {
        tvBackdropRef.current.show(nextImage);
        return;
      }
      tvBackdropRef.current?.hide();
      backdropTimer.current = window.setTimeout(() => {
        backdropTimer.current = undefined;
        tvBackdropRef.current?.show(nextImage);
      }, TV_BACKDROP_SETTLE_MS);
      return;
    }
    if (!nextImage || nextImage === heroImageRef.current) return;
    applyHeroImage(nextImage);
  }

  function applyHeroImage(nextImage: string) {
    if (heroImageRef.current) {
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

  // The handle's functions close over the latest render, so keep it current every render.
  useImperativeHandle(ref, () => ({
    preview: previewFocusedItem,
    show: showHero,
    syncScroll: (scrollTop: number) => {
      if (tv) return;
      const offset = Math.max(-180, scrollTop * -0.22);
      backdropRef.current?.style.setProperty("--home-backdrop-offset", `${offset}px`);
    }
  }));

  useEffect(() => {
    if (skipInitial?.()) return;
    const firstItem = rails[0]?.items[0];
    const known = focusedItem ? rails.some(rail => rail.items.some(item => item.Id === focusedItem.Id)) : false;
    if (firstItem && !known) showHero(firstItem, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rails, session, focusedItem]);

  useEffect(() => () => {
    if (heroTimer.current !== undefined) window.clearTimeout(heroTimer.current);
    if (focusTimer.current !== undefined) window.clearTimeout(focusTimer.current);
    if (marqueeTimer.current !== undefined) window.clearTimeout(marqueeTimer.current);
    if (ambientTintTimer.current !== undefined) window.clearTimeout(ambientTintTimer.current);
    if (backdropTimer.current !== undefined) window.clearTimeout(backdropTimer.current);
  }, []);

  function finishBackdropTransition() {
    if (heroTimer.current !== undefined) window.clearTimeout(heroTimer.current);
    heroTimer.current = window.setTimeout(() => {
      setPreviousHeroImage("");
      heroTimer.current = undefined;
    }, 360);
  }

  return (
    <>
      {tv ? <TvBackdrop ref={tvBackdropRef} /> : (
      <div ref={backdropRef} className="home-hero-backdrop" aria-hidden="true">
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
      </div>
      )}
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
    </>
  );
});

type TvBackdropHandle = {
  /** Load `url` (if it is not the one showing) and fade it in. */
  show: (url: string) => void;
  /** Fade the backdrop out while focus is moving. */
  hide: () => void;
  /** The URL on screen or being loaded. */
  showing: () => string;
};

/**
 * TV backdrop: two image elements that stay in the DOM for the life of the screen and take
 * turns. Everything it does is an opacity change on an existing compositor layer, so a focus
 * change never creates or destroys layers and never repaints the screen. The soft left and
 * bottom edges are a fixed gradient drawn over the image (the page background shows through
 * a CSS mask the same way, but a mask costs an extra surface on every frame of a fade).
 *
 * React renders this once. Sources and classes are set directly on the elements.
 */
const TvBackdrop = forwardRef<TvBackdropHandle>(function TvBackdrop(_props, ref) {
  const first = useRef<HTMLImageElement>(null);
  const second = useRef<HTMLImageElement>(null);
  /** Which element holds the current image. */
  const front = useRef<0 | 1>(0);
  const wanted = useRef("");
  const token = useRef(0);

  useImperativeHandle(ref, () => ({
    show(url: string) {
      const images = [first.current, second.current];
      const current = images[front.current];
      if (!current || !images[1 - front.current]) return;
      if (!url) {
        wanted.current = "";
        token.current += 1;
        images.forEach(image => image?.classList.remove("shown"));
        return;
      }
      if (wanted.current === url && current.dataset.url === url) {
        current.classList.add("shown");
        return;
      }
      wanted.current = url;
      const request = ++token.current;
      const back = images[1 - front.current]!;
      back.classList.remove("shown");
      back.dataset.url = url;
      back.src = url;
      const reveal = () => {
        if (token.current !== request) return;
        current.classList.remove("shown");
        back.classList.add("shown");
        front.current = (1 - front.current) as 0 | 1;
      };
      // decode() keeps the image decode off the main thread and resolves when it can be
      // shown without a hitch. A failed load leaves the backdrop empty.
      back.decode().then(reveal).catch(() => { if (token.current === request) current.classList.remove("shown"); });
    },
    hide() {
      token.current += 1;
      wanted.current = "";
      first.current?.classList.remove("shown");
      second.current?.classList.remove("shown");
    },
    showing: () => wanted.current
  }), []);

  return (
    <div className="home-hero-backdrop tv-backdrop" aria-hidden="true">
      <img ref={first} className="tv-backdrop-image" alt="" decoding="async" />
      <img ref={second} className="tv-backdrop-image" alt="" decoding="async" />
      <div className="tv-backdrop-shade" />
    </div>
  );
});

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
  // Time-left ring (as on Details) for anything with an unfinished resume point.
  const position = (item.UserData?.PlaybackPositionTicks ?? 0) / 10_000_000;
  const duration = (item.RunTimeTicks ?? 0) / 10_000_000;
  const resumable = item.UserData?.Played !== true && isResumable(position, duration);

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
        {resumable ? <ResumeProgress position={position} duration={duration} /> : null}
      </div>
      {item.Overview ? <p className="home-featured-overview">{item.Overview}</p> : null}
    </div>
  );
}
