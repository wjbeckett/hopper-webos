import { describe, expect, it } from "vitest";
import { EMPTY_ACCESS, createAccessFields, updateAccessFields, withChild, withRequests } from "./profileAccess";

describe("a profile's requests switch (#172)", () => {
  it("is on for a new profile and sends nothing", () => {
    expect(EMPTY_ACCESS.requestsAllowed).toBe(true);
    expect(createAccessFields(EMPTY_ACCESS, true)).not.toHaveProperty("requests_allowed");
  });

  it("turns off with Child Profile unless it was set here", () => {
    expect(withChild(EMPTY_ACCESS, true).requestsAllowed).toBe(false);
    expect(withChild(withRequests(EMPTY_ACCESS, true), true).requestsAllowed).toBe(true);
  });

  it("is sent only to a server that has it", () => {
    const blocked = withRequests(EMPTY_ACCESS, false);
    expect(createAccessFields(blocked, true)).toMatchObject({ requests_allowed: false });
    expect(createAccessFields(blocked, false)).not.toHaveProperty("requests_allowed");
    expect(updateAccessFields(blocked, EMPTY_ACCESS, null, true)).toMatchObject({ requests_allowed: false });
    expect(updateAccessFields(blocked, EMPTY_ACCESS, null, false)).not.toHaveProperty("requests_allowed");
  });

  it("isn't sent on an edit that didn't change it", () => {
    const loaded = { ...EMPTY_ACCESS, requestsAllowed: false };
    expect(updateAccessFields(loaded, loaded, null, true)).not.toHaveProperty("requests_allowed");
  });
});
