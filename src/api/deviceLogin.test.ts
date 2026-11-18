import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindingForServer, deviceLoginBindingOf, pollDeviceLogin, startDeviceLogin } from "./deviceLogin";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("sign-in binding (#173)", () => {
  it("matches the server contract's example: 32 zero bytes", async () => {
    const binding = await deviceLoginBindingOf(new Uint8Array(32));
    expect(binding).toEqual({ binding: "Zmh6rfhivXdsj8GLjp-OIAiXFIVu4jOzkCpZHQ1fKSU", secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
  });

  it("is used only over HTTPS with a server that checks it", async () => {
    const binding = await deviceLoginBindingOf(new Uint8Array(32));
    expect(await bindingForServer("http://silo.local:8080", binding)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(json({ state: "available", session_binding: true }));
    expect(await bindingForServer("https://silo.example.com", binding)).toBe(binding);
    fetchMock.mockResolvedValueOnce(json({ state: "available" }));
    expect(await bindingForServer("https://silo.example.com", binding)).toBeNull();
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await bindingForServer("https://silo.example.com", binding)).toBeNull();
  });

  it("sends the binding on start and the secret on every poll", async () => {
    const binding = await deviceLoginBindingOf(new Uint8Array(32));
    fetchMock.mockResolvedValueOnce(json({ device_code: "d" })).mockResolvedValueOnce(json({ status: "pending" })).mockResolvedValueOnce(json({ status: "pending" }));
    await startDeviceLogin("https://silo.example.com", "TV", binding);
    await pollDeviceLogin("https://silo.example.com", "d", binding);
    await pollDeviceLogin("https://silo.example.com", "d");
    const bodies = fetchMock.mock.calls.map(call => JSON.parse(call[1].body));
    expect(bodies[0]).toMatchObject({ binding: "Zmh6rfhivXdsj8GLjp-OIAiXFIVu4jOzkCpZHQ1fKSU" });
    expect(bodies[1]).toEqual({ device_code: "d", binding_secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    expect(bodies[2]).toEqual({ device_code: "d" });
  });
});
