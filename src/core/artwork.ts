/**
 * Media artwork helpers: ThumbHash blur-up placeholders and deferred
 * presentation while scrolling, mirroring Android TV's ThumbhashImage
 * (android-shared/.../common/ui/components/ThumbhashImage.kt).
 *
 * Android decodes the server's base64 thumbhash into a small bitmap shown
 * fillMaxSize + Crop while the full image loads, then crossfades the full
 * image in over 300ms. Newly decoded art is not presented mid-scroll:
 * requests and decodes keep running, only the first presentation of freshly
 * decoded artwork waits until the scroll settles (memory-cache hits still
 * present immediately). The global scroll tracker below is the webOS
 * equivalent of LocalImagePresentationDeferral + DeferImagePresentationWhileScrolling.
 */

const BASE64: Record<string, number> = {};
{
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("");
  for (let i = 0; i < alphabet.length; i++) BASE64[alphabet[i]] = i;
}

function decodeBase64(hash: string): Uint8Array | null {
  const clean = hash.replace(/=+$/, "");
  if (!clean || /[^A-Za-z0-9+/]/.test(clean)) return null;
  if (clean.length % 4 === 1) return null;
  const bytes: number[] = [];
  let bits = 0;
  let buffered = 0;
  for (const char of clean) {
    bits = (bits << 6) | BASE64[char];
    buffered += 6;
    if (buffered >= 8) {
      buffered -= 8;
      bytes.push((bits >> buffered) & 255);
      bits &= buffered === 0 ? 0 : (1 << buffered) - 1;
    }
  }
  return Uint8Array.from(bytes);
}

const thumbhashCache = new Map<string, string | null>();
const MAX_CACHE_ENTRIES = 256;

/**
 * Decode a base64 ThumbHash into a small PNG data URL suitable for
 * `object-fit: cover` fill. Returns null for missing/malformed hashes.
 * Results are cached process-wide (Android keeps a 256-entry LRU cache).
 */
export function thumbhashToDataURL(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const key = hash.trim();
  if (!key) return null;
  if (thumbhashCache.has(key)) return thumbhashCache.get(key) ?? null;
  const decoded = decodeThumbhash(key);
  if (thumbhashCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = thumbhashCache.keys().next().value;
    if (oldest !== undefined) thumbhashCache.delete(oldest);
  }
  thumbhashCache.set(key, decoded);
  return decoded;
}

/**
 * The reference ThumbHash decoder (https://evanw.github.io/thumbhash/, `thumbHashToRGBA`), as
 * Android ports it in android-shared ThumbHash.kt: a picture at most 32 px on its long edge.
 * Returns null for bytes that are not a ThumbHash.
 */
export function thumbHashToRGBA(hash: Uint8Array): { width: number; height: number; rgba: Uint8ClampedArray } | null {
  if (hash.length < 5) return null;
  const header24 = hash[0] | (hash[1] << 8) | (hash[2] << 16);
  const header16 = hash[3] | (hash[4] << 8);
  const lDc = (header24 & 63) / 63;
  const pDc = ((header24 >> 6) & 63) / 31.5 - 1;
  const qDc = ((header24 >> 12) & 63) / 31.5 - 1;
  const lScale = ((header24 >> 18) & 31) / 31;
  const hasAlpha = (header24 >> 23) !== 0;
  const lCount = header16 & 7;
  const pScale = ((header16 >> 3) & 63) / 63;
  const qScale = ((header16 >> 9) & 63) / 63;
  const isLandscape = (header16 >> 15) !== 0;
  const lx = Math.max(3, isLandscape ? (hasAlpha ? 5 : 7) : lCount);
  const ly = Math.max(3, isLandscape ? lCount : (hasAlpha ? 5 : 7));
  if (hasAlpha && hash.length < 6) return null;
  const aDc = hasAlpha ? (hash[5] & 15) / 15 : 1;
  const aScale = hasAlpha ? (hash[5] >> 4) / 15 : 0;

  // AC terms: one 4-bit stream shared by all channels.
  const acStart = hasAlpha ? 6 : 5;
  let acIndex = 0;
  let truncated = false;
  const decodeChannel = (nx: number, ny: number, scale: number) => {
    const ac: number[] = [];
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++) {
        const at = acStart + (acIndex >> 1);
        if (at >= hash.length) truncated = true;
        ac.push((((hash[at] >> ((acIndex & 1) << 2)) & 15) / 7.5 - 1) * scale);
        acIndex++;
      }
    }
    return ac;
  };
  const lAc = decodeChannel(lx, ly, lScale);
  const pAc = decodeChannel(3, 3, pScale * 1.25);
  const qAc = decodeChannel(3, 3, qScale * 1.25);
  const aAc = hasAlpha ? decodeChannel(5, 5, aScale) : [];
  if (truncated) return null;

  const ratio = lx / ly;
  const width = Math.max(1, Math.round(ratio > 1 ? 32 : 32 * ratio));
  const height = Math.max(1, Math.round(ratio > 1 ? 32 / ratio : 32));
  const rgba = new Uint8ClampedArray(width * height * 4);
  const fx: number[] = new Array(Math.max(lx, hasAlpha ? 5 : 3)).fill(0);
  const fy: number[] = new Array(Math.max(ly, hasAlpha ? 5 : 3)).fill(0);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 4) {
      let l = lDc, p = pDc, q = qDc, a = aDc;
      for (let cx = 0; cx < fx.length; cx++) fx[cx] = Math.cos(Math.PI / width * (x + 0.5) * cx);
      for (let cy = 0; cy < fy.length; cy++) fy[cy] = Math.cos(Math.PI / height * (y + 0.5) * cy);
      for (let cy = 0, j = 0; cy < ly; cy++) {
        const fy2 = fy[cy] * 2;
        for (let cx = cy ? 0 : 1; cx * ly < lx * (ly - cy); cx++, j++) l += lAc[j] * fx[cx] * fy2;
      }
      for (let cy = 0, j = 0; cy < 3; cy++) {
        const fy2 = fy[cy] * 2;
        for (let cx = cy ? 0 : 1; cx < 3 - cy; cx++, j++) {
          const f = fx[cx] * fy2;
          p += pAc[j] * f;
          q += qAc[j] * f;
        }
      }
      if (hasAlpha) {
        for (let cy = 0, j = 0; cy < 5; cy++) {
          const fy2 = fy[cy] * 2;
          for (let cx = cy ? 0 : 1; cx < 5 - cy; cx++, j++) a += aAc[j] * fx[cx] * fy2;
        }
      }
      const b = l - 2 / 3 * p;
      const r = (3 * l - b + q) / 2;
      const g = r - q;
      rgba[i] = 255 * Math.min(1, Math.max(0, r));
      rgba[i + 1] = 255 * Math.min(1, Math.max(0, g));
      rgba[i + 2] = 255 * Math.min(1, Math.max(0, b));
      rgba[i + 3] = 255 * Math.min(1, Math.max(0, a));
    }
  }
  return { width, height, rgba };
}

function decodeThumbhash(hash: string): string | null {
  if (typeof document === "undefined") return null;
  const bytes = decodeBase64(hash);
  const decoded = bytes ? thumbHashToRGBA(bytes) : null;
  if (!decoded) return null;
  const canvas = document.createElement("canvas");
  canvas.width = decoded.width;
  canvas.height = decoded.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(decoded.width, decoded.height);
  image.data.set(decoded.rgba);
  context.putImageData(image, 0, 0);
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * Global scroll-motion tracker. Mirrors Android's
 * DeferImagePresentationWhileScrolling: freshly decoded art holds its first
 * presentation until scrolling settles; memory-cache hits (and anything that
 * resolved before the cover was seen) appear instantly.
 */
let scrolling = false;
let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;
const settleListeners = new Set<() => void>();

function setScrolling(next: boolean) {
  if (scrolling === next) return;
  scrolling = next;
  if (!scrolling) {
    for (const listener of [...settleListeners]) listener();
  }
}

function installScrollTracking() {
  if (typeof window === "undefined") return;
  const markActive = () => {
    setScrolling(true);
    if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => setScrolling(false), 120);
  };
  window.addEventListener("scroll", markActive, { passive: true, capture: true });
  window.addEventListener("wheel", markActive, { passive: true });
}

let trackingInstalled = false;
export function isScrolling(): boolean {
  if (!trackingInstalled) {
    trackingInstalled = true;
    installScrollTracking();
  }
  return scrolling;
}

export function onScrollSettled(listener: () => void): () => void {
  // Tracking is lazy; a listener alone must also start it or it never fires.
  if (!trackingInstalled) {
    trackingInstalled = true;
    installScrollTracking();
  }
  settleListeners.add(listener);
  return () => {
    settleListeners.delete(listener);
  };
}

/** URLs fetched and decoded ahead of time; their cards skip the TV near-screen load gate. */
const warmArtwork = new Map<string, HTMLImageElement>();

export function isWarmArtwork(url: string): boolean {
  return warmArtwork.get(url)?.complete === true;
}

/** Fetch + decode an image in the background and keep it referenced so it stays cached. */
export function warmArtworkImage(url: string): Promise<void> {
  if (!url || warmArtwork.has(url)) return Promise.resolve();
  const image = new Image();
  image.decoding = "async";
  warmArtwork.set(url, image);
  image.src = url;
  return image.decode().catch(() => { warmArtwork.delete(url); });
}

/** LG webOS TV panels: decode and composite budget is far below a desktop browser. */
export const isTvDevice = (): boolean =>
  typeof navigator !== "undefined" && /Web0S|webOS/i.test(navigator.userAgent);

/**
 * Remote navigation tracker (TV only use): true from an arrow key until it has been
 * quiet for NAV_IDLE_MS. Posters hold their file load while it is true, then come in
 * together once the user stops, as Plex does.
 */
const NAV_IDLE_MS = 180;
let navigating = false;
let navIdleTimer: ReturnType<typeof setTimeout> | null = null;
let navTrackingInstalled = false;
const navSettledListeners = new Set<() => void>();

function installNavTracking() {
  if (navTrackingInstalled || typeof window === "undefined") return;
  navTrackingInstalled = true;
  window.addEventListener("keydown", (event) => {
    if (!event.key.startsWith("Arrow")) return;
    navigating = true;
    if (navIdleTimer) clearTimeout(navIdleTimer);
    navIdleTimer = setTimeout(() => {
      navigating = false;
      for (const listener of [...navSettledListeners]) listener();
    }, NAV_IDLE_MS);
  }, { capture: true, passive: true });
}

export function isNavigating(): boolean {
  installNavTracking();
  return navigating;
}

export function onNavigationSettled(listener: () => void): () => void {
  installNavTracking();
  navSettledListeners.add(listener);
  return () => { navSettledListeners.delete(listener); };
}

/** Milliseconds of wait that still present instantly (Android: 100ms). */
export const INSTANT_REVEAL_MS = 100;
