import { useEffect, useRef, useState } from "react";
import {
  INSTANT_REVEAL_MS,
  isNavigating,
  isScrolling,
  isTvDevice,
  onNavigationSettled,
  isWarmArtwork,
  onScrollSettled,
  thumbhashToDataURL,
} from "../core/artwork";

/** How far past the screen edge (px) a card still counts as near enough to load on the TV. */
const NEAR_X = 520;
const NEAR_Y = 420;
/** Off-screen (but near) cards wait this long after the remote settles, so visible posters load first. */
const PREFETCH_DELAY_MS = 450;

export type DefaultArtworkKind = "Video" | "Tv" | "Audiobook" | "Book";

const ARTWORK_PATHS: Record<DefaultArtworkKind, string> = {
  Video: "M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 14H3V5h18zM10 8.5v7l6-3.5z",
  Tv: "M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 14H3V5h18zM9 8l6 3.5L9 15z",
  Audiobook:
    "M12 3a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h3v-7H5v-3a7 7 0 0 1 14 0v3h-4v7h3a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z",
  Book: "M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 4h5v8l-2.5-1.5L6 12zM18 20H6V4h12z",
};

/** Mirrors Android `DefaultArtwork`: base #16171C, brand radial glows, faint mark. */
export function DefaultArtwork({ kind }: { kind: DefaultArtworkKind }) {
  return (
    <div className="default-artwork" aria-hidden="true">
      <svg className="default-artwork-mark" viewBox="0 0 24 24" focusable="false">
        <path d={ARTWORK_PATHS[kind]} fill="currentColor" />
      </svg>
    </div>
  );
}

export function defaultArtworkKindForType(type: string | undefined): DefaultArtworkKind {
  const value = (type ?? "").toLowerCase();
  if (value === "series" || value === "season" || value === "episode") return "Tv";
  if (value === "audiobook" || value === "podcast") return "Audiobook";
  if (value === "ebook" || value === "book" || value === "comic" || value === "manga" || value === "reading")
    return "Book";
  return "Video";
}

type Props = {
  url: string;
  thumbhash?: string | null;
  kind: DefaultArtworkKind;
  className?: string;
  hideImage?: boolean;
  onError?: () => void;
  width?: number;
  height?: number;
};

/**
 * WebOS equivalent of Android `ThumbhashImage`: thumbhash blur-up cover,
 * 300ms crossfade, deferred presentation while scrolling, DefaultArtwork
 * fallback when artwork is missing/failed and no usable thumbhash exists.
 */
export function ArtworkImage({ url, thumbhash, kind, className, hideImage, onError, width, height }: Props) {
  const placeholder = thumbhashToDataURL(thumbhash);
  const hasUsableThumbhash = placeholder != null;
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [presented, setPresented] = useState(false);
  const [instant, setInstant] = useState(false);
  const requestedAtRef = useRef(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  // TV: the file is requested only for cards near the screen, and only while the remote is quiet.
  // Already fetched (e.g. warmed ahead of time): no network cost, so show it at once.
  const [wanted, setWanted] = useState(() => !isTvDevice() || isWarmArtwork(url));

  useEffect(() => {
    if (!isTvDevice()) return;
    let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
    const clearTimer = () => {
      if (prefetchTimer) clearTimeout(prefetchTimer);
      prefetchTimer = undefined;
    };
    const check = () => {
      const el = wrapRef.current;
      if (!el || isNavigating()) return;
      if (loadedRef.current) return; // already loaded: keep it
      const r = el.getBoundingClientRect();
      const visible = r.right > 0 && r.left < window.innerWidth
        && r.bottom > 0 && r.top < window.innerHeight;
      const near = r.right > -NEAR_X && r.left < window.innerWidth + NEAR_X
        && r.bottom > -NEAR_Y && r.top < window.innerHeight + NEAR_Y;
      if (visible) {
        // On screen: request now, ahead of everything else.
        clearTimer();
        setWanted(true);
      } else if (near) {
        // Just off screen: wait so the visible cards get the connection and decoder first.
        if (!prefetchTimer) prefetchTimer = setTimeout(() => { prefetchTimer = undefined; setWanted(true); }, PREFETCH_DELAY_MS);
      } else {
        // Scrolled far away before it loaded: drop the request so it stops
        // queueing ahead of the cards that are on screen now.
        clearTimer();
        setWanted(false);
      }
    };
    const frame = requestAnimationFrame(check);
    const offNav = onNavigationSettled(check);
    const offScroll = onScrollSettled(check);
    return () => {
      cancelAnimationFrame(frame);
      clearTimer();
      offNav();
      offScroll();
    };
  }, []);
  const presentedRef = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    loadedRef.current = false;
    setFailed(false);
    setReady(false);
    setPresented(false);
    presentedRef.current = false;
    setInstant(false);
    requestedAtRef.current = performance.now();
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setReady(true);
    }
  }, [url]);

  const present = () => {
    if (presentedRef.current) return;
    presentedRef.current = true;
    setPresented(true);
    const waited = performance.now() - requestedAtRef.current;
    if (waited < INSTANT_REVEAL_MS) setInstant(true);
  };

  useEffect(() => {
    if (!ready || presented) return;
    if (!isScrolling()) {
      present();
      return;
    }
    const off = onScrollSettled(present);
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, presented, url]);

  const hasUrl = Boolean(url && url.trim());
  const failedArtwork = failed && !hasUsableThumbhash;
  const showCover = hasUrl && !failed && wanted;

  return (
    <div ref={wrapRef} className={`artwork-image ${className ?? ""}`}>
      {placeholder ? (
        <img className="artwork-placeholder" src={placeholder} alt="" aria-hidden="true" draggable={false} />
      ) : null}
      {!placeholder && !failedArtwork ? (
        <div className="artwork-solid" aria-hidden="true" />
      ) : null}
      {failedArtwork ? <DefaultArtwork kind={kind} /> : null}
      {showCover ? (
        <img
          ref={imgRef}
          className={
            `artwork-full${hideImage ? " spoiler-hidden-image" : ""}` +
            `${presented ? (instant ? " artwork-instant" : " artwork-revealed") : " artwork-hidden"}`
          }
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          width={width}
          height={height}
          draggable={false}
          onLoad={() => {
            loadedRef.current = true;
            const img = imgRef.current;
            const cached = Boolean(img && img.complete && img.naturalWidth > 0);
            if (cached || !isScrolling()) present();
            setReady(true);
          }}
          onError={() => {
            setFailed(true);
            onErrorRef.current?.();
          }}
        />
      ) : null}
    </div>
  );
}
