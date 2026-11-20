import { beforeEach, describe, expect, it } from "vitest";
import { ACCENT_CHANGED_EVENT, ACCENT_PRESETS, accentVariables, applyAccent, cachedAccent, contrastRatio, markColour, normalizeHex, profileAccentChoice, rememberAccent, resolveAccent, setProfileAccentChoice } from "./accent";

describe("the server's accent colour (#201)", () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute("style"); });

  it("accepts #rgb and #rrggbb, and nothing else", () => {
    expect(normalizeHex(" #3AF ")).toBe("#33aaff");
    expect(normalizeHex("#2DD4BF")).toBe("#2dd4bf");
    expect(normalizeHex("teal")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
    expect(accentVariables("rgb(1,2,3)")).toBeNull();
  });

  it("keeps an accent that already reads on a dark panel", () => {
    expect(markColour("#2dd4bf")).toBe("#2dd4bf");
  });

  it("lightens a mid-grey accent that would read on black but not on a ticked row", () => {
    expect(contrastRatio(markColour("#858585"), "#3c3c3e")).toBeGreaterThanOrEqual(4.5);
    expect(markColour("#858585")).not.toBe("#858585");
  });

  it("lightens a dark accent until a mark reads at 4.5:1", () => {
    const mark = markColour("#1a237e");
    expect(mark).not.toBe("#1a237e");
    expect(contrastRatio(mark, "#3c3c3e")).toBeGreaterThanOrEqual(4.5);
    expect(markColour("#000000")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("sets the mark and glow variables, and clears them for no accent", () => {
    applyAccent("#e50914");
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--server-accent")).toMatch(/^#[0-9a-f]{6}$/);
    expect(style.getPropertyValue("--server-accent-glow")).toContain("rgba(229,9,20,.16)");
    expect(document.documentElement.dataset.accent).toBe("true");
    applyAccent(null);
    expect(document.documentElement.dataset.accent).toBeUndefined();
    expect(style.getPropertyValue("--server-accent")).toBe("");
    expect(style.getPropertyValue("--server-accent-glow")).toBe("");
  });

  it("remembers the accent per server, and forgets it when the server drops it", () => {
    rememberAccent("https://a.test", "#E50914");
    rememberAccent("https://b.test", "#2dd4bf");
    expect(cachedAccent("https://a.test")).toBe("#e50914");
    rememberAccent("https://a.test", undefined);
    expect(cachedAccent("https://a.test")).toBeNull();
    expect(cachedAccent("https://b.test")).toBe("#2dd4bf");
  });
});

describe("a profile's own accent on this TV (#201)", () => {
  beforeEach(() => localStorage.clear());

  it("uses the server's colour until the profile picks one", () => {
    expect(profileAccentChoice("https://a.test", "p1")).toBe("server");
    expect(resolveAccent("server", "#ff0000")).toBe("#ff0000");
    expect(resolveAccent("server", undefined)).toBeNull();
  });

  it("keeps each profile's pick separately, per server", () => {
    setProfileAccentChoice("https://a.test", "p1", "#3B82F6");
    setProfileAccentChoice("https://a.test", "p2", "none");
    expect(profileAccentChoice("https://a.test", "p1")).toBe("#3b82f6");
    expect(profileAccentChoice("https://a.test", "p2")).toBe("none");
    expect(profileAccentChoice("https://b.test", "p1")).toBe("server");
    expect(profileAccentChoice("https://a.test", undefined)).toBe("server");
  });

  it("lets the pick win over the server, and none turn the accent off", () => {
    expect(resolveAccent("#3b82f6", "#ff0000")).toBe("#3b82f6");
    expect(resolveAccent("none", "#ff0000")).toBeNull();
  });

  it("goes back to the server's colour, and announces each change", () => {
    let changes = 0;
    const count = () => { changes += 1; };
    window.addEventListener(ACCENT_CHANGED_EVENT, count);
    setProfileAccentChoice("https://a.test", "p1", "#22c55e");
    setProfileAccentChoice("https://a.test", "p1", "server");
    window.removeEventListener(ACCENT_CHANGED_EVENT, count);
    expect(profileAccentChoice("https://a.test", "p1")).toBe("server");
    expect(changes).toBe(2);
  });

  it("offers presets that are all valid colours", () => {
    for (const preset of ACCENT_PRESETS) expect(normalizeHex(preset.hex)).toBe(preset.hex);
  });
});
