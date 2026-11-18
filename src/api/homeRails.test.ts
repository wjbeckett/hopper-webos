import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../types";

vi.mock("../core/secureStore", () => ({
  loadSecrets: async () => undefined,
  secureStorageAvailable: () => true,
  storedSecurely: () => true,
  subscribeStorageHealth: () => () => undefined,
  secretsFor: () => undefined,
  setSecrets: () => undefined,
  clearSecrets: () => undefined,
  secretsSettled: async () => true
}));

const { getHomeRails } = await import("./silo");

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
let counter = 0;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

function session(): Session {
  counter += 1;
  // A server of its own per test: capabilities are cached per server.
  return { serverUrl: `https://home${counter}.example.com`, accessToken: "a", refreshToken: "r", userId: "u", username: "", profileId: "p" };
}

const movie = (id: string) => ({ content_id: id, type: "movie", title: id });

describe("Home in one request (#178)", () => {
  it("takes the first rows from the layout and reads only the rest, each capped", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/images/capabilities")) return json({ state: "unsupported" });
      if (url.includes("/home/capabilities")) return json({ state: "available", include_items_max: 2, row_item_limit_max: 50 });
      if (url.includes("/home/layout")) return json({
        sections: [{ id: 1, title: "One" }, { id: 2, title: "Two" }, { id: 3, title: "Three" }],
        included_sections: [{ id: 1, items: [movie("a")] }, { id: 2, items: [movie("b")] }]
      });
      if (url.includes("/home/sections/3/items")) return json({ items: [movie("c")] });
      throw new Error(`unexpected ${url}`);
    });
    const rails = await getHomeRails(session());
    expect(rails.map(rail => rail.items.map(item => item.Id))).toEqual([["a"], ["b"], ["c"]]);
    const urls = fetchMock.mock.calls.map(call => String(call[0]));
    expect(urls.find(url => url.includes("/home/layout"))).toMatch(/include_items=2&item_limit=20/);
    expect(urls.filter(url => url.includes("/home/sections/"))).toEqual([expect.stringMatching(/\/home\/sections\/3\/items\?item_limit=20$/)]);
  });

  it("reads every row as before on a server without the capability", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/images/capabilities")) return json({ state: "unsupported" });
      if (url.includes("/home/capabilities")) return new Response("", { status: 404 });
      if (url.includes("/home/layout")) return json({ sections: [{ id: 1, title: "One" }] });
      if (url.includes("/home/sections/1/items")) return json({ items: [movie("a")] });
      throw new Error(`unexpected ${url}`);
    });
    const rails = await getHomeRails(session());
    expect(rails[0].items[0].Id).toBe("a");
    const urls = fetchMock.mock.calls.map(call => String(call[0]));
    expect(urls.find(url => url.includes("/home/layout"))).toMatch(/\/home\/layout$/);
    expect(urls.find(url => url.includes("/home/sections/1/items"))).toMatch(/\/items$/);
  });
});
