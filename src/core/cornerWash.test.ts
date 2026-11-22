import { describe, expect, it } from "vitest";
import { cornerGradient, renderCornerWash, sampleCorners, thumbhashCorners } from "./cornerWash";

/** A `size` x `size` RGBA bitmap whose four quarters are flat colours. */
function quarters(size: number, tl: number[], tr: number[], bl: number[], br: number[]) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const colour = y < size / 2 ? (x < size / 2 ? tl : tr) : (x < size / 2 ? bl : br);
    rgba.set([...colour, 255], (y * size + x) * 4);
  }
  return rgba;
}

const hue = ({ r, g, b }: { r: number; g: number; b: number }) => (r >= g && r >= b ? "red" : g >= b ? "green" : "blue");

describe("the Home backdrop's corner colours (#207)", () => {
  it("takes each corner from its own quarter of the art", () => {
    const corners = sampleCorners(quarters(8, [200, 30, 30], [30, 30, 200], [30, 30, 200], [200, 30, 30]), 8, 8)!;
    expect([hue(corners.topLeft), hue(corners.topRight), hue(corners.bottomLeft), hue(corners.bottomRight)]).toEqual(["red", "blue", "blue", "red"]);
  });

  it("gives the bottom right a hue that differs from both its neighbours when the art has one", () => {
    const rgba = quarters(8, [200, 30, 30], [30, 30, 200], [30, 200, 30], [200, 30, 30]);
    // The bottom-right quarter: blue on its left half, red on its right, so the two tie on area.
    for (let y = 4; y < 8; y += 1) for (let x = 4; x < 6; x += 1) rgba.set([30, 30, 200, 255], (y * 8 + x) * 4);
    const corners = sampleCorners(rgba, 8, 8)!;
    expect(hue(corners.topRight)).toBe("blue");
    expect(hue(corners.bottomRight)).toBe("red");
  });

  it("caps brightness, darkest behind the title, and lifts real colour", () => {
    const corners = sampleCorners(quarters(8, [250, 120, 120], [250, 120, 120], [250, 120, 120], [250, 120, 120]), 8, 8)!;
    expect(Math.max(corners.topLeft.r, corners.topLeft.g, corners.topLeft.b)).toBeCloseTo(0.2, 5);
    expect(Math.max(corners.topRight.r, corners.topRight.g, corners.topRight.b)).toBeCloseTo(0.4, 5);
    const { r, g } = corners.topRight;
    expect((r - g) / r).toBeGreaterThanOrEqual(0.6 - 1e-9);
  });

  it("keeps grey art grey", () => {
    const corners = sampleCorners(quarters(8, [90, 90, 90], [90, 90, 90], [90, 90, 90], [90, 90, 90]), 8, 8)!;
    for (const corner of Object.values(corners)) expect(corner.r).toBeCloseTo(corner.b, 5);
  });

  it("draws one glow per corner, and copes with a missing or broken hash", () => {
    const corners = sampleCorners(quarters(4, [200, 30, 30], [200, 30, 30], [200, 30, 30], [200, 30, 30]), 4, 4)!;
    expect(cornerGradient(corners).match(/radial-gradient/g)).toHaveLength(4);
    expect(thumbhashCorners(undefined)).toBeNull();
    expect(thumbhashCorners("!!")).toBeNull();
    expect(thumbhashCorners("1QcSHQRnh493V4dIh4eXh1h4kJUI")).not.toBeNull();
  });
});

describe("the TV's wash bitmap (#207)", () => {
  const corners = { topLeft: { r: 0.2, g: 0, b: 0 }, topRight: { r: 0, g: 0, b: 0.4 }, bottomRight: { r: 0, g: 0.4, b: 0 }, bottomLeft: { r: 0.4, g: 0.4, b: 0 } };
  const at = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

  it("is each corner's colour at that corner, close to opaque", () => {
    const pixels = renderCornerWash(corners, 40, 20);
    expect(at(pixels, 40, 0, 0).slice(0, 2)).toEqual([51, 0]); expect(at(pixels, 40, 0, 0)[3]).toBeGreaterThan(240);
    const topRight = at(pixels, 40, 39, 0); expect(topRight[2]).toBeGreaterThan(Math.max(topRight[0], topRight[1]));
    expect(at(pixels, 40, 0, 19)[3]).toBeGreaterThan(240);
  });

  it("leaves a hole where the art is, and keeps the wash outside it", () => {
    const hole = { left: 20, fadeX: 5, top: 5, bottom: 15 };
    const pixels = renderCornerWash(corners, 40, 20, hole);
    expect(at(pixels, 40, 35, 2)[3]).toBe(0);
    expect(at(pixels, 40, 5, 2)[3]).toBeGreaterThan(230);
    expect(at(pixels, 40, 35, 19)[3]).toBeGreaterThan(200);
    expect(at(pixels, 40, 22, 2)[3]).toBeGreaterThan(0);
    expect(at(pixels, 40, 22, 2)[3]).toBeLessThan(255);
  });
});
