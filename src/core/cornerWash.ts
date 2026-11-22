/**
 * The Home backdrop's corner colours (#207): each corner of the screen takes its colour from the
 * same quarter of the artwork, so the page carries the art's colours where they sit in it. A port
 * of tvOS's `HeroBackdropPalette.sampleCorners` (silo-apple #1218; Android TV #987 does the same).
 *
 * The pixels come from the backdrop's ThumbHash, which the item already carries: a picture of at
 * most 32 px decoded in well under a millisecond, with no image fetch or canvas read. That is what
 * makes it affordable on a TV, where sampling the artwork itself was too slow.
 */
import { decodeBase64, thumbHashToRGBA } from "./artwork";

export type Rgb = { r: number; g: number; b: number };
export type Corners = { topLeft: Rgb; topRight: Rgb; bottomRight: Rgb; bottomLeft: Rgb };

/** Brightest a corner may be (HSV value). Top left sits behind the hero's title, so it stays darkest. */
const TOP_LEFT_VALUE_CEILING = 0.2;
const CORNER_VALUE_CEILING = 0.4;
/** A corner with any real colour is lifted to at least this saturation, so it reads as a colour. */
const CORNER_MINIMUM_SATURATION = 0.6;
/** Below this saturation, or this value, a pixel counts as neutral. */
const NEUTRAL_SATURATION = 0.18;
const NEUTRAL_VALUE = 0.12;
const HUE_BUCKETS = 12;
const NEUTRAL = -1;

function hsv({ r, g, b }: Rgb) {
  const value = Math.max(r, g, b);
  const chroma = value - Math.min(r, g, b);
  if (chroma <= 0) return { hue: 0, saturation: 0, value };
  let hue = value === r ? (g - b) / chroma : value === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  hue = (hue / 6) % 1;
  if (hue < 0) hue += 1;
  return { hue, saturation: chroma / value, value };
}

function fromHsv(hue: number, saturation: number, value: number): Rgb {
  const sector = (hue * 6) % 6;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][Math.min(5, Math.floor(sector))];
  const offset = value - chroma;
  return { r: r + offset, g: g + offset, b: b + offset };
}

function hueDistance(a: number, b: number) {
  const difference = Math.abs(a - b) % 1;
  return Math.min(difference, 1 - difference) * 360;
}

/**
 * A quarter's most telling colour: pixels go into twelve hue buckets and one neutral bucket, and
 * each bucket's mean is scored on how much of the quarter it covers and how saturated it is. Grey
 * art stays grey, but a modest patch of real colour beats a larger grey area. Greens are marked
 * down (darkened, they go olive), and so is a hue too close to any hue in `avoid`.
 */
function cornerPick(pixels: Rgb[], avoid: Array<number | null>): { colour: Rgb; hue: number | null } {
  const buckets = new Map<number, Rgb[]>();
  for (const pixel of pixels) {
    const { hue, saturation, value } = hsv(pixel);
    // Near-white is usually a blown-out sky or a plain field, not a colour the art is about.
    if (value > 0.97 && saturation < 0.05) continue;
    const key = saturation > NEUTRAL_SATURATION && value > NEUTRAL_VALUE ? Math.min(HUE_BUCKETS - 1, Math.floor(hue * HUE_BUCKETS)) : NEUTRAL;
    const members = buckets.get(key);
    if (members) members.push(pixel); else buckets.set(key, [pixel]);
  }
  let total = 0;
  buckets.forEach(members => { total += members.length; });
  let best = { score: -Infinity, colour: { r: 0, g: 0, b: 0 } as Rgb, hue: null as number | null };
  buckets.forEach((members, key) => {
    const colour = mean(members);
    const { hue, saturation } = hsv(colour);
    let score = 100 * Math.sqrt(members.length / total) + (saturation >= 0.5 ? 120 : 240 * saturation);
    if (key === NEUTRAL) score -= 40;
    else {
      if (hue >= 0.22 && hue <= 0.4) score -= 60;
      for (const neighbour of avoid) if (neighbour != null && hueDistance(hue, neighbour) < 15) score -= 30;
    }
    if (score > best.score) best = { score, colour, hue: key === NEUTRAL ? null : hue };
  });
  return { colour: best.colour, hue: best.hue };
}

function mean(pixels: Rgb[]): Rgb {
  const sum = pixels.reduce((total, pixel) => ({ r: total.r + pixel.r, g: total.g + pixel.g, b: total.b + pixel.b }), { r: 0, g: 0, b: 0 });
  return { r: sum.r / pixels.length, g: sum.g / pixels.length, b: sum.b / pixels.length };
}

/** A deep colour that rows and text stay readable over: brightness capped, real colour saturated. */
function cornerTint(colour: Rgb, valueCeiling: number): Rgb {
  const { hue, saturation, value } = hsv(colour);
  return fromHsv(hue, saturation > NEUTRAL_SATURATION ? Math.max(saturation, CORNER_MINIMUM_SATURATION) : saturation, Math.min(value, valueCeiling));
}

/**
 * One colour per corner of a `width` x `height` RGBA bitmap, row 0 at the top. Top right and bottom
 * left avoid the top-left hue, and bottom right avoids both the top-right and bottom-left hues, so neighbours differ
 * when the art allows it.
 */
export function sampleCorners(rgba: ArrayLike<number>, width: number, height: number): Corners | null {
  if (width < 2 || height < 2 || rgba.length < width * height * 4) return null;
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);
  const quarter = (x0: number, x1: number, y0: number, y1: number) => {
    const pixels: Rgb[] = [];
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
      const index = (y * width + x) * 4;
      pixels.push({ r: rgba[index] / 255, g: rgba[index + 1] / 255, b: rgba[index + 2] / 255 });
    }
    return pixels;
  };
  const topLeft = cornerPick(quarter(0, midX, 0, midY), []);
  const topRight = cornerPick(quarter(midX, width, 0, midY), [topLeft.hue]);
  const bottomLeft = cornerPick(quarter(0, midX, midY, height), [topLeft.hue]);
  const bottomRight = cornerPick(quarter(midX, width, midY, height), [topRight.hue, bottomLeft.hue]);
  return {
    topLeft: cornerTint(topLeft.colour, TOP_LEFT_VALUE_CEILING),
    topRight: cornerTint(topRight.colour, CORNER_VALUE_CEILING),
    bottomRight: cornerTint(bottomRight.colour, CORNER_VALUE_CEILING),
    bottomLeft: cornerTint(bottomLeft.colour, CORNER_VALUE_CEILING)
  };
}

const css = ({ r, g, b }: Rgb, alpha: number) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;

/**
 * The corners as one background: a radial glow from each corner, fading out 4/3 of the box's width
 * and height away, so neighbouring glows overlap and blend (as tvOS draws them).
 */
export function cornerGradient(corners: Corners) {
  const glow = (colour: Rgb, at: string) => `radial-gradient(133.33% 133.33% at ${at}, ${css(colour, 1)}, ${css(colour, 0)} 100%)`;
  return [glow(corners.topLeft, "0 0"), glow(corners.topRight, "100% 0"), glow(corners.bottomRight, "100% 100%"), glow(corners.bottomLeft, "0 100%")].join(", ");
}

/** The wash for a backdrop's ThumbHash, or null when it has none. */
export function cornerWash(thumbhash: string | null | undefined) {
  const corners = thumbhashCorners(thumbhash);
  return corners ? cornerGradient(corners) : null;
}

/**
 * The TV's wash as pixels (#207): the same four glows as `cornerGradient`, composited in the same
 * order, with a hole where the art shows that blends out along the art's soft left and bottom edges.
 *
 * On a TV the wash goes on a small canvas scaled up by the compositor. A CSS gradient behind a CSS
 * mask was re-rastered at full screen size on every change, which halved the frame rate on Home
 * (measured on a webOS 22 TV); a canvas is a texture uploaded once, so scaling and fading it costs
 * the compositor only. `hole` is in the bitmap's pixels: the art covers x from `left` and y down to
 * `bottom`, and fades in over `fadeX` and `fadeY`.
 */
export function renderCornerWash(corners: Corners, width: number, height: number, hole?: { left: number; fadeX: number; top: number; bottom: number }) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const rx = width * 4 / 3;
  const ry = height * 4 / 3;
  // Bottom of the stack first, as CSS paints a background list from the last layer up.
  const glows: Array<[Rgb, number, number]> = [[corners.bottomLeft, 0, height], [corners.bottomRight, width, height], [corners.topRight, width, 0], [corners.topLeft, 0, 0]];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [colour, cx, cy] of glows) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const alpha = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
        if (!alpha) continue;
        const out = alpha + a * (1 - alpha);
        r = (colour.r * alpha + r * a * (1 - alpha)) / out;
        g = (colour.g * alpha + g * a * (1 - alpha)) / out;
        b = (colour.b * alpha + b * a * (1 - alpha)) / out;
        a = out;
      }
      if (hole) {
        // Wash shows left of the art (fading out across fadeX) and below it (fading in across fadeY).
        const left = Math.min(1, Math.max(0, (hole.left + hole.fadeX - (x + 0.5)) / hole.fadeX));
        const below = Math.min(1, Math.max(0, (y + 0.5 - hole.top) / (hole.bottom - hole.top)));
        a *= left + below - left * below;
      }
      const index = (y * width + x) * 4;
      pixels[index] = r * 255;
      pixels[index + 1] = g * 255;
      pixels[index + 2] = b * 255;
      pixels[index + 3] = a * 255;
    }
  }
  return pixels;
}

const cache = new Map<string, Corners | null>();

/** The corner colours of a backdrop's ThumbHash, cached; null with no hash or a bad one. */
export function thumbhashCorners(thumbhash: string | null | undefined): Corners | null {
  const key = thumbhash?.trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  const bytes = decodeBase64(key);
  const image = bytes ? thumbHashToRGBA(bytes, 24) : null;
  const corners = image ? sampleCorners(image.rgba, image.width, image.height) : null;
  if (cache.size >= 256) { const oldest = cache.keys().next().value; if (oldest !== undefined) cache.delete(oldest); }
  cache.set(key, corners);
  return corners;
}
