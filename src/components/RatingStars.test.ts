import { describe, expect, it } from "vitest";
import { starsLabel, stepRating } from "./RatingStars";

describe("star ratings (#180)", () => {
  it("shows the server's 1 to 10 as stars with halves", () => {
    expect(starsLabel(7)).toBe("3.5");
    expect(starsLabel(10)).toBe("5");
    expect(starsLabel(1)).toBe("0.5");
    expect(starsLabel(0)).toBe("Rate");
  });

  it("moves half a star per press, from no rating to five stars", () => {
    expect(stepRating(0, 1)).toBe(1);
    expect(stepRating(7, -1)).toBe(6);
    expect(stepRating(1, -1)).toBe(0);
    expect(stepRating(0, -1)).toBe(0);
    expect(stepRating(10, 1)).toBe(10);
  });
});
