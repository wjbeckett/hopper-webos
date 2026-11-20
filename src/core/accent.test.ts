import { beforeEach, describe, expect, it } from "vitest";
import { accentVariables, applyAccent, cachedAccent, contrastRatio, markColour, normalizeHex, rememberAccent } from "./accent";

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
