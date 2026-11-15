import { describe, expect, it } from "vitest";
import { claimAutoTranslation, hasMachineTranslatedOverview, runDescriptionTranslation, TRANSLATION_POLL_SECONDS } from "./descriptionTranslation";

const noWait = async () => undefined;

describe("runDescriptionTranslation", () => {
  it("reads the item until the pending language clears", async () => {
    const answers = ["fr", "fr", null];
    let reads = 0;
    const result = await runDescriptionTranslation({
      request: async () => "pending",
      refetchPending: async () => answers[reads++],
      isCurrent: () => true,
      wait: noWait
    });
    expect(result).toBe("translated");
    expect(reads).toBe(3);
  });

  it("fails on a reused failed or canceled job without reading", async () => {
    for (const status of ["failed", "canceled"]) {
      let reads = 0;
      const result = await runDescriptionTranslation({ request: async () => status, refetchPending: async () => { reads++; return null; }, isCurrent: () => true, wait: noWait });
      expect(result).toBe("failed");
      expect(reads).toBe(0);
    }
  });

  it("fails when the language is still pending after the last read", async () => {
    const waits: number[] = [];
    const result = await runDescriptionTranslation({ request: async () => "running", refetchPending: async () => "de", isCurrent: () => true, wait: async ms => { waits.push(ms); } });
    expect(result).toBe("failed");
    expect(waits).toEqual(TRANSLATION_POLL_SECONDS.map(seconds => seconds * 1000));
  });

  it("fails when the request or a read throws", async () => {
    expect(await runDescriptionTranslation({ request: async () => { throw new Error("500"); }, refetchPending: async () => null, isCurrent: () => true, wait: noWait })).toBe("failed");
    expect(await runDescriptionTranslation({ request: async () => "pending", refetchPending: async () => { throw new Error("offline"); }, isCurrent: () => true, wait: noWait })).toBe("failed");
  });

  it("stops without a result once the screen has moved on", async () => {
    let current = true;
    let reads = 0;
    const result = await runDescriptionTranslation({
      request: async () => "pending",
      refetchPending: async () => { reads++; current = false; return "fr"; },
      isCurrent: () => current,
      wait: noWait
    });
    expect(result).toBe("abandoned");
    expect(reads).toBe(1);
  });
});

describe("claimAutoTranslation", () => {
  it("claims a title and language once", () => {
    expect(claimAutoTranslation("m1", "fr")).toBe(true);
    expect(claimAutoTranslation("m1", "fr")).toBe(false);
    expect(claimAutoTranslation("m1", "de")).toBe(true);
  });
});

describe("hasMachineTranslatedOverview", () => {
  it("is true only when the overview itself was translated", () => {
    expect(hasMachineTranslatedOverview(["overview"])).toBe(true);
    expect(hasMachineTranslatedOverview(["tagline"])).toBe(false);
    expect(hasMachineTranslatedOverview(undefined)).toBe(false);
  });
});
