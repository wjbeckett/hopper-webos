import { describe, expect, it } from "vitest";
import { cornerGradient, sampleCorners, thumbhashCorners } from "./cornerWash";

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
