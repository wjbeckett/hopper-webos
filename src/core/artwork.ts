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

function decodeBase64(hash: string): Uint8Array | null {
  try {
    const binary = atob(hash);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
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
 * Android ports it in android-shared ThumbHash.kt: a picture at most `maxEdge` px on its long edge.
 * Returns null for bytes that are not a ThumbHash.
 */
export function thumbHashToRGBA(hash: Uint8Array, maxEdge = 32): { width: number; height: number; rgba: Uint8ClampedArray } | null {
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
  const width = Math.max(1, Math.round(ratio > 1 ? maxEdge : maxEdge * ratio));
  const height = Math.max(1, Math.round(ratio > 1 ? maxEdge / ratio : maxEdge));
  const rgba = new Uint8ClampedArray(width * height * 4);
  // The cosines depend only on the column or the row, so they are worked out once each (the
  // reference recomputes them for every pixel, which costs several ms per hash on a TV).
  const nx = Math.max(lx, hasAlpha ? 5 : 3);
  const ny = Math.max(ly, hasAlpha ? 5 : 3);
  const cosX = new Float64Array(width * nx);
  const cosY = new Float64Array(height * ny);
  for (let x = 0; x < width; x++) for (let cx = 0; cx < nx; cx++) cosX[x * nx + cx] = Math.cos(Math.PI / width * (x + 0.5) * cx);
  for (let y = 0; y < height; y++) for (let cy = 0; cy < ny; cy++) cosY[y * ny + cy] = Math.cos(Math.PI / height * (y + 0.5) * cy);
  for (let y = 0, i = 0; y < height; y++) {
    const fy = cosY.subarray(y * ny, y * ny + ny);
    for (let x = 0; x < width; x++, i += 4) {
      const fx = cosX.subarray(x * nx, x * nx + nx);
      let l = lDc, p = pDc, q = qDc, a = aDc;
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

/**
 * The decoded picture as a BMP data URL. Writing the few kilobytes of a BMP by hand is several
 * times cheaper on a TV than drawing to a canvas and encoding a PNG.
 */
const BYTE_CHARS = Array.from({ length: 256 }, (_, byte) => String.fromCharCode(byte));

function bmpDataUrl({ width, height, rgba }: { width: number; height: number; rgba: Uint8ClampedArray }): string {
  const headerSize = 14 + 108;
  const bytes = new Uint8Array(headerSize + width * height * 4);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42; bytes[1] = 0x4d; // "BM"
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, headerSize, true);
  view.setUint32(14, 108, true); // BITMAPV4HEADER, which carries an alpha mask
  view.setInt32(18, width, true);
  view.setInt32(22, -height, true); // top row first
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  view.setUint32(30, 3, true); // BI_BITFIELDS
  view.setUint32(34, width * height * 4, true);
  view.setUint32(54, 0x00ff0000, true);
  view.setUint32(58, 0x0000ff00, true);
  view.setUint32(62, 0x000000ff, true);
  view.setUint32(66, 0xff000000, true);
  view.setUint32(70, 0x73524742, true); // "sRGB"
  for (let i = 0, o = headerSize; i < rgba.length; i += 4, o += 4) {
    bytes[o] = rgba[i + 2];
    bytes[o + 1] = rgba[i + 1];
    bytes[o + 2] = rgba[i];
    bytes[o + 3] = rgba[i + 3];
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += BYTE_CHARS[bytes[i]];
  return `data:image/bmp;base64,${btoa(binary)}`;
}

function decodeThumbhash(hash: string): string | null {
  const bytes = decodeBase64(hash);
  // 16 px, not Android's 32: a ThumbHash holds only a few low-frequency terms, so the browser's
  // scaling draws the same blur, and a quarter of the pixels keeps a 130-episode season to a few
  // tens of ms on a TV.
  const decoded = bytes ? thumbHashToRGBA(bytes, 16) : null;
  return decoded ? bmpDataUrl(decoded) : null;
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
