import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../types";

// Tokens live in core/secureStore (WebCrypto and IndexedDB on the TV). Here they are kept in
// memory, as they would be where secure storage works.
vi.mock("../core/secureStore", () => {
  const secrets = new Map<string, Record<string, string | undefined>>();
  return {
    loadSecrets: async () => undefined,
    secureStorageAvailable: () => true,
    storedSecurely: () => true,
    subscribeStorageHealth: () => () => undefined,
    secretsFor: (url: string) => secrets.get(url),
    setSecrets: (url: string, value: Record<string, string | undefined>) => { secrets.set(url, value); },
    clearSecrets: (url: string) => { secrets.delete(url); },
    secretsSettled: async () => true
  };
});

const { getCatalogItem, refreshSession } = await import("./silo");
const { serverRegistry } = await import("../core/serverRegistry");
const { subscribeSessionExpired } = await import("./connection");

const SERVER = "https://silo.test";
let counter = 0;
/** A fresh user for each test, so single-flight refreshes from one test cannot leak into the next. */
function signedIn(overrides: Partial<Session> = {}): Session {
  counter += 1;
  const session: Session = { serverUrl: SERVER, accessToken: "access-1", refreshToken: "refresh-1", userId: `user-${counter}`, username: "viewer", profileId: "profile-1", ...overrides };
  serverRegistry.saveSession({ ...session });
  return session;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("catalog items", () => {
  it("maps a native episode, with its position as ticks and its progress worked out", async () => {
    const session = signedIn();
    fetchMock.mockResolvedValueOnce(json({
      content_id: "episode-1", type: "episode", title: "Grammy Night", series_title: "Dancing with the Stars", series_id: 79590,
      season_number: 35, episode_number: 10, runtime_minutes: 85, user_data: { position_seconds: 1020 }, poster_url: "/p.jpg"
    }));
    const item = await getCatalogItem(session, "episode-1");
    expect(item).toMatchObject({ Id: "episode-1", Name: "Grammy Night", Type: "Episode", SeriesName: "Dancing with the Stars", SeriesId: "79590", ParentIndexNumber: 35, IndexNumber: 10, RuntimeMinutes: 85, PosterUrl: "/p.jpg" });
    expect(item.RunTimeTicks).toBe(85 * 60 * 10_000_000);
    expect(item.UserData?.PlaybackPositionTicks).toBe(1020 * 10_000_000);
    expect(item.UserData?.PlayedPercentage).toBeCloseTo(1020 / (85 * 60) * 100);
  });

  it("calls the native v2 route with the session's token and profile", async () => {
    const session = signedIn({ profileToken: "pin-token" });
    fetchMock.mockResolvedValueOnce(json({ content_id: "movie-1", type: "movie", title: "A Film" }));
    await getCatalogItem(session, "movie 1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SERVER}/api/v2/catalog/items/movie%201`);
    expect(init.headers).toMatchObject({ Authorization: "Bearer access-1", "X-Profile-Id": "profile-1", "X-Profile-Token": "pin-token" });
  });

  it("leaves out user data when the server sent none", async () => {
    const session = signedIn();
    fetchMock.mockResolvedValueOnce(json({ content_id: "movie-2", type: "movie", title: "Untouched" }));
    expect((await getCatalogItem(session, "movie-2")).UserData).toBeUndefined();
  });
});

describe("sign-in refresh", () => {
  it("renews an expired access token once and retries the request", async () => {
    const session = signedIn();
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(json({ access_token: "access-2", refresh_token: "refresh-2" }))
      .mockResolvedValueOnce(json({ content_id: "movie-1", type: "movie", title: "A Film" }));
    await getCatalogItem(session, "movie-1");
    expect(fetchMock.mock.calls[1][0]).toBe(`${SERVER}/api/v2/auth/refresh`);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ refresh_token: "refresh-1" });
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer access-2");
    expect(serverRegistry.active()?.session?.refreshToken).toBe("refresh-2");
  });

  it("makes one refresh call for parallel callers, and all of them get the new tokens", async () => {
    const session = signedIn();
    const copy = { ...session };
    let release: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise<Response>(resolve => { release = resolve; }));
    const first = refreshSession(session);
    const second = refreshSession(copy);
    release(json({ access_token: "access-2", refresh_token: "refresh-2" }));
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(session.refreshToken).toBe("refresh-2");
    expect(copy.refreshToken).toBe("refresh-2");
  });

  it("ends the sign-in when the server refuses the refresh token, and keeps the server", async () => {
    const session = signedIn();
    const expired = vi.fn();
    const stop = subscribeSessionExpired(expired);
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(refreshSession(session)).rejects.toThrow("AUTH_EXPIRED");
    stop();
    expect(expired).toHaveBeenCalledWith(SERVER);
    expect(serverRegistry.active()?.url).toBe(SERVER);
    expect(serverRegistry.active()?.session).toBeUndefined();
  });

  it("keeps the sign-in when the server fails for another reason", async () => {
    const session = signedIn();
    fetchMock.mockResolvedValueOnce(new Response("", { status: 502 }));
    await expect(refreshSession(session)).rejects.toThrow("502");
    expect(serverRegistry.active()?.session?.refreshToken).toBe("refresh-1");
  });

  it("does not sign back in when the sign-in was cleared while the refresh was out", async () => {
    const session = signedIn();
    let release: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise<Response>(resolve => { release = resolve; }));
    const pending = refreshSession(session);
    serverRegistry.clearSession(SERVER);
    release(json({ access_token: "access-2", refresh_token: "refresh-2" }));
    await expect(pending).rejects.toThrow("AUTH_EXPIRED");
    expect(serverRegistry.active()?.session).toBeUndefined();
  });
});
