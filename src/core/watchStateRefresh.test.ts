import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWatchStateRefresh } from "./watchState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("Home's rows when the app comes back (#205)", () => {
  afterEach(() => setVisibility("visible"));

  it("reads again as soon as the app is visible, not a poll later", async () => {
    const refresh = vi.fn(() => Promise.resolve());
    function Probe() { useWatchStateRefresh(refresh, 300, 20_000); return null; }
    const root = createRoot(document.createElement("div"));
    await act(async () => { root.render(createElement(Probe)); });
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => { setVisibility("hidden"); });
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => { setVisibility("visible"); });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => { root.unmount(); });
    setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
