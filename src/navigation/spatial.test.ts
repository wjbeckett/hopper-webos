import { describe, expect, it } from "vitest";
import { candidateScore, navRowEntry, navRowInDirection } from "./spatial";

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

describe("rows of controls (data-nav-row)", () => {
  // jsdom lays nothing out: give each element a position and an offsetParent.
  const place = (element: HTMLElement, rect: DOMRect) => {
    element.getBoundingClientRect = () => rect;
    Object.defineProperty(element, "offsetParent", { configurable: true, get: () => document.body });
  };
  const row = (top: number, labels: string[], selected?: string) => {
    const element = document.createElement("div");
    element.dataset.navRow = "true";
    place(element, box(0, top, 1600, 100));
    labels.forEach((label, index) => {
      const button = document.createElement("button");
      button.textContent = label;
      button.dataset.tvFocusable = "true";
      if (selected !== undefined) button.setAttribute("aria-pressed", String(label === selected));
      place(button, box(index * 200, top, 180, 100));
      element.append(button);
    });
    return element;
  };

  it("finds the nearest row above or below, and enters it at its selected control", () => {
    document.body.innerHTML = "";
    const screen = document.createElement("main");
    screen.className = "content-screen";
    const filters = row(100, ["Following", "Trending", "All"], "Trending");
    const week = row(250, ["Previous week", "Mon", "Tue"]);
    screen.append(filters, week);
    document.body.append(screen);

    const card = box(200, 500, 300, 500);
    expect(navRowInDirection(card, "up")).toBe(week);
    expect(navRowInDirection(week.getBoundingClientRect(), "up", week)).toBe(filters);
    expect(navRowInDirection(filters.getBoundingClientRect(), "up", filters)).toBeUndefined();
    expect(navRowInDirection(filters.getBoundingClientRect(), "down", filters)).toBe(week);
    expect(navRowEntry(filters)?.textContent).toBe("Trending");
    expect(navRowEntry(week)?.textContent).toBe("Previous week");
  });
});
