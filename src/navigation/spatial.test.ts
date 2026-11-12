import { describe, expect, it } from "vitest";
import { candidateScore } from "./spatial";

const box = (x: number, y: number, width = 100, height = 100) => ({ left: x, top: y, width, height, right: x + width, bottom: y + height, x, y, toJSON() { return this; } }) as DOMRect;

describe("spatial navigation scoring", () => {
  const from = box(500, 500);

  it("rules out candidates in the wrong direction", () => {
    expect(candidateScore(from, box(300, 500), "right")).toBe(Infinity);
    expect(candidateScore(from, box(700, 500), "left")).toBe(Infinity);
    expect(candidateScore(from, box(500, 700), "up")).toBe(Infinity);
    expect(candidateScore(from, box(500, 300), "down")).toBe(Infinity);
  });

  it("rules out a candidate level with the current one", () => {
    expect(candidateScore(from, box(500, 500), "right")).toBe(Infinity);
  });

  it("prefers the nearer candidate along the direction", () => {
    expect(candidateScore(from, box(650, 500), "right")).toBeLessThan(candidateScore(from, box(900, 500), "right"));
  });

  it("weighs sideways drift more than distance, so a row's neighbour beats a closer diagonal", () => {
    const sameRow = candidateScore(from, box(800, 500), "right");
    const diagonal = candidateScore(from, box(650, 700), "right");
    expect(sameRow).toBeLessThan(diagonal);
  });
});
