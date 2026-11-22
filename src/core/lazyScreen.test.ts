import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { lazyScreen } from "./lazyScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Hello({ name }: { name: string }) { return createElement("p", null, `Hello ${name}`); }

describe("screens loaded when they open (#208)", () => {
  it("shows the loading state, then the screen with its props", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const Screen = lazyScreen(() => gate.then(() => ({ Hello })), "Hello");
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => { root.render(createElement(Screen, { name: "Ada" })); });
    expect(host.querySelector(".loading-state")).not.toBeNull();
    await act(async () => { release(); await gate; });
    expect(host.textContent).toBe("Hello Ada");
    await act(async () => { root.unmount(); });
  });

  it("loads once however often it is preloaded, and tries a failed load once more", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValue({ Hello });
    const Screen = lazyScreen(load, "Hello");
    await Promise.all([Screen.preload(), Screen.preload()]);
    expect(load).toHaveBeenCalledTimes(2);
    await Screen.preload();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("offers to try again when the load fails twice, and loads afresh when asked", async () => {
    const load = vi.fn<() => Promise<{ Hello: typeof Hello }>>()
      .mockRejectedValueOnce(new Error("read failed"))
      .mockRejectedValueOnce(new Error("read failed again"))
      .mockResolvedValue({ Hello });
    const Screen = lazyScreen(load, "Hello");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => { root.render(createElement(Screen, { name: "Ada" })); });
    await act(async () => { await Promise.resolve(); });
    const retry = host.querySelector("button");
    expect(retry?.textContent).toBe("Try again");
    expect(document.activeElement).toBe(retry);
    await act(async () => { retry!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toBe("Hello Ada");
    expect(load).toHaveBeenCalledTimes(3);
    quiet.mockRestore();
    await act(async () => { root.unmount(); });
    host.remove();
  });
});
