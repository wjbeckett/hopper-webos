import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SCREENSAVER_MINUTES, revealCorner, screensaverLabel, screensaverMinutes, setScreensaverMinutes, subscribeScreensaver } from "./screensaver";

describe("the screensaver setting (#209)", () => {
  beforeEach(() => localStorage.clear());

  it("starts at the default, and keeps a choice", () => {
    expect(screensaverMinutes()).toBe(DEFAULT_SCREENSAVER_MINUTES);
    setScreensaverMinutes(0);
    expect(screensaverMinutes()).toBe(0);
    setScreensaverMinutes(15);
    expect(screensaverMinutes()).toBe(15);
  });

  it("ignores a stored value it doesn't offer", () => {
    localStorage.setItem("hopper-screensaver-v1", "7");
    expect(screensaverMinutes()).toBe(DEFAULT_SCREENSAVER_MINUTES);
  });

  it("tells listeners about a change", () => {
    let calls = 0;
    const unsubscribe = subscribeScreensaver(() => { calls += 1; });
    setScreensaverMinutes(2);
    unsubscribe();
    setScreensaverMinutes(5);
    expect(calls).toBe(1);
  });

  it("names the choices, and moves the title between corners", () => {
    expect(screensaverLabel(0)).toBe("Off");
    expect(screensaverLabel(10)).toBe("After 10 minutes");
    expect([0, 1, 2, 3].map(revealCorner)).toEqual(["left", "right", "left", "right"]);
  });
});
