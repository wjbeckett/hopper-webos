import { describe, expect, it } from "vitest";
import { applyGridPaintWindow } from "./gridWindow";

function grid(count: number) {
  const element = document.createElement("div");
  element.className = "library-grid";
  for (let i = 0; i < count; i++) {
    const card = document.createElement("button");
    card.textContent = String(i);
    element.append(card);
  }
  document.body.append(element);
  return element;
}

describe("applyGridPaintWindow", () => {
  // jsdom has no grid layout, so the grid reads as one column: the window is 13 cards around focus.
  it("hides cards far from focus and shows the ones near it", () => {
    const element = grid(30);
    applyGridPaintWindow(element, element.children[0]);
    expect(element.children[6].classList.contains("grid-far")).toBe(false);
    expect(element.children[20].classList.contains("grid-far")).toBe(true);
  });

  it("shows a hidden card that a re-sort moved next to focus", async () => {
    const element = grid(30);
    applyGridPaintWindow(element, element.children[0]);
    const moved = element.children[20];
    expect(moved.classList.contains("grid-far")).toBe(true);
    // Same number of cards, new order (PersonalScreen sorts locally).
    element.insertBefore(moved, element.children[1]);
    await Promise.resolve();
    applyGridPaintWindow(element, element.children[0]);
    expect(moved.classList.contains("grid-far")).toBe(false);
  });
});
