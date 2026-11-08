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

function toLinear(value: number, scale: number): number {
  const normalized = Math.min(1, Math.max(0, (value / 8191) * scale));
  return normalized <= 0.055 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
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

export function thumbhashUsable(hash: string | null | undefined): boolean {
  return thumbhashToDataURL(hash) !== null;
}

function decodeThumbhash(hash: string): string | null {
  if (typeof document === "undefined") return null;
  const bytes = decodeBase64(hash);
  if (!bytes || bytes.length < 3) return null;
  const h0 = bytes[0];
  const h1 = bytes[1];
  if ((h0 & 0b1110_0001) !== 0b0010_0001) return null;
  const hasAlpha = (h1 & 0b0010_0000) !== 0;
  const dcBits = (((h1 >> 6) & 3) << 3) | (h1 & 0b0001_1111);
  const acBits = (h1 >> 5) & 1 ? dcBits : 0;
  if (acBits === 0 || dcBits <= 0) return null;
  const width = (bytes[2] & 0b1111) + 1;
  const height = ((bytes[2] >> 4) & 0b1111) + 1;
  const dcCount = hasAlpha ? 4 : 3;
  const dcWidth = dcBits / 3;

  let bitIndex = 24;
  const next = (count: number): number | null => {
    if (bitIndex + count > bytes.length * 8) return null;
    let value = 0;
    for (let i = 0; i < count; i++) {
      const at = bitIndex + i;
      value |= (((bytes[at >> 3] >> (at & 7)) & 1) << i);
    }
    bitIndex += count;
    return value;
  };

  const dc: number[] = [];
  for (let i = 0; i < dcCount; i++) {
    const value = next(dcWidth);
    if (value == null) return null;
    dc.push(value);
  }
  const acCount = 5 * dcCount;
  const ac: number[] = [];
  const acWidth = Math.max(1, Math.round(acBits / 5));
  for (let i = 0; i < acCount; i++) {
    const value = next(acWidth);
    if (value == null) return null;
    ac.push(value);
  }

  const dcScale = 1 / (1 << dcWidth);
  const dcR = toLinear(dc[0], dcScale);
  const dcG = toLinear(dc[1], dcScale);
  const dcB = toLinear(dc[2], dcScale);
  const dcA = hasAlpha ? Math.min(1, Math.max(0, dc[3] / ((1 << dcWidth) - 1))) : 1;

  // AC basis (thumbhash spec): L = cos(pi*fx)*cos(pi*fy),
  // P = cos(pi*fx)*sin(pi*fy), Q = sin(pi*fx)*sin(pi*fy).
  const basis = (kind: number, fx: number, fy: number) => {
    if (kind === 0) return Math.cos(Math.PI * fx) * Math.cos(Math.PI * fy);
    if (kind === 1) return Math.cos(Math.PI * fx) * Math.sin(Math.PI * fy);
    return Math.sin(Math.PI * fx) * Math.sin(Math.PI * fy);
  };

  const canvasWidth = Math.max(8, width * 8);
  const canvasHeight = Math.max(8, height * 8);
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(canvasWidth, canvasHeight);
  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const fx = x / canvasWidth;
      const fy = y / canvasHeight;
      let r = dcR;
      let g = dcG;
      let b = dcB;
      let a = dcA;
      for (let i = 0; i < acCount; i++) {
        const coefficient = ac[i];
        if (!coefficient) continue;
        const channel = (i / 5) | 0;
        const kind = i % 5;
        const scale = kind < 2 ? 1 / 31 : kind < 4 ? 1 / 63 : 1 / 7;
        const contribution = ((coefficient / 31) * scale) * basis(kind % 3, fx, fy);
        if (channel === 0) r += contribution;
        else if (channel === 1) g += contribution;
        else if (channel === 2) b += contribution;
        else a += contribution * 0.1;
      }
      const at = (y * canvasWidth + x) * 4;
      image.data[at] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      image.data[at + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
      image.data[at + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
      image.data[at + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
    }
  }
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
/** Fade the full image in over this long once presented (Android: 300ms). */
export const REVEAL_CROSSFADE_MS = 300;

