import { describe, expect, it } from "vitest";
import { subtitleSearchAvailableAfter } from "./subtitles";

describe("offering subtitle search (#204)", () => {
  const available = { state: "available", allowed: true, enabled: true, providers: ["opensubtitles"] };

  it("offers search only when the profile is allowed, a provider is on and the capability is available", () => {
    expect(subtitleSearchAvailableAfter(available, null)).toBe(true);
    expect(subtitleSearchAvailableAfter({ ...available, allowed: false }, true)).toBe(false);
    expect(subtitleSearchAvailableAfter({ ...available, enabled: false }, true)).toBe(false);
    expect(subtitleSearchAvailableAfter({ ...available, state: "not_configured" }, true)).toBe(false);
  });

  it("keeps the last answer when the read fails, and offers search when there is none", () => {
    expect(subtitleSearchAvailableAfter(null, false)).toBe(false);
    expect(subtitleSearchAvailableAfter(null, true)).toBe(true);
    expect(subtitleSearchAvailableAfter(null, null)).toBe(true);
  });
});
