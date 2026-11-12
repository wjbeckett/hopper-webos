import { describe, expect, it } from "vitest";
import { isResumable, remainingLabel } from "./ResumeProgress";

describe("time left", () => {
  it("is a resume point only past 30 s and before the last 5 s", () => {
    expect(isResumable(30, 3600)).toBe(false);
    expect(isResumable(31, 3600)).toBe(true);
    expect(isResumable(3596, 3600)).toBe(false);
    expect(isResumable(100, 0)).toBe(false);
  });

  it("reads as hours and minutes, minutes, or seconds left", () => {
    expect(remainingLabel(3 * 3600 + 25 * 60)).toBe("3h 25m left");
    expect(remainingLabel(17 * 60 + 40)).toBe("17m left");
    expect(remainingLabel(45)).toBe("45s left");
    expect(remainingLabel(-3)).toBe("0s left");
  });
});
