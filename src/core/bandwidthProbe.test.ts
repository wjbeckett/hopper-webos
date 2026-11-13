import { afterEach, describe, expect, it, vi } from "vitest";
import { freshProbeKbps } from "./bandwidthProbe";
import type { Session } from "../types";

const session = { serverUrl: "https://silo.example.test" } as Session;
const KEY = "hopper-bandwidth-probe-v1";

describe("automatic speed-test reading", () => {
  afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it("is used while it is younger than its lifetime", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    localStorage.setItem(KEY, JSON.stringify({ [session.serverUrl]: { kbps: 4200, at: 1_000_000 - 59_000, lifetimeMs: 60_000 } }));
    expect(freshProbeKbps(session)).toBe(4200);
  });

  it("is ignored once it is older than its lifetime", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    localStorage.setItem(KEY, JSON.stringify({ [session.serverUrl]: { kbps: 4200, at: 1_000_000 - 61_000, lifetimeMs: 60_000 } }));
    expect(freshProbeKbps(session)).toBeNull();
  });

  it("belongs to one server", () => {
    localStorage.setItem(KEY, JSON.stringify({ "https://other.example.test": { kbps: 4200, at: Date.now(), lifetimeMs: 60_000 } }));
    expect(freshProbeKbps(session)).toBeNull();
  });

  it("survives unreadable storage", () => {
    localStorage.setItem(KEY, "not json");
    expect(freshProbeKbps(session)).toBeNull();
  });
});
