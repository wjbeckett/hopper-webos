import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SUBTITLE_APPEARANCE } from "../api/settings";
import { deviceCaptioningAppearance } from "./captions";
import { openYoutube } from "./youtube";

// The TV's browser provides PalmServiceBridge; LG's webOSTV.js (window.webOS) is not loaded (#106).
type Call = { uri: string; params: Record<string, unknown> };
function installBridge(answer: (call: Call) => Record<string, unknown> | "silent" | "garbage") {
  const calls: Call[] = [];
  class FakeBridge {
    onservicecallback: ((raw: string) => void) | null = null;
    call(uri: string, params: string) {
      const call = { uri, params: JSON.parse(params) as Record<string, unknown> };
      calls.push(call);
      const reply = answer(call);
      if (reply === "silent") return;
      setTimeout(() => this.onservicecallback?.(reply === "garbage" ? "{not json" : JSON.stringify(reply)), 0);
    }
  }
  vi.stubGlobal("PalmServiceBridge", FakeBridge);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("deviceCaptioningAppearance", () => {
  it("reads the TV's caption settings through PalmServiceBridge", async () => {
    const calls = installBridge(() => ({
      returnValue: true,
      settings: { captionSize: "large", captionTextColor: "yellow", captionTextOpacity: "solid", captionBgColor: "black", captionBgOpacity: "transparent", captionEdgeType: "uniform" }
    }));
    const result = await deviceCaptioningAppearance(DEFAULT_SUBTITLE_APPEARANCE);
    expect(calls).toHaveLength(1);
    expect(calls[0].uri).toBe("luna://com.webos.settingsservice/getSystemSettings");
    expect(calls[0].params.category).toBe("caption");
    expect(result).toMatchObject({ fontSize: "xlarge", fontColor: "#facc15", textOpacity: 100, backgroundColor: "#000000", backgroundOpacity: 0, backgroundStyle: "none", textOutline: true });
  });

  it("keeps Hopper's settings in a browser without the bridge", async () => {
    expect(await deviceCaptioningAppearance(DEFAULT_SUBTITLE_APPEARANCE)).toEqual(DEFAULT_SUBTITLE_APPEARANCE);
  });

  it("keeps Hopper's settings when the service refuses or the reply is unreadable", async () => {
    installBridge(() => ({ returnValue: false, errorText: "denied" }));
    expect(await deviceCaptioningAppearance(DEFAULT_SUBTITLE_APPEARANCE)).toEqual(DEFAULT_SUBTITLE_APPEARANCE);
    installBridge(() => "garbage");
    expect(await deviceCaptioningAppearance(DEFAULT_SUBTITLE_APPEARANCE)).toEqual(DEFAULT_SUBTITLE_APPEARANCE);
  });

  it("gives up after two seconds without an answer", async () => {
    vi.useFakeTimers();
    installBridge(() => "silent");
    const pending = deviceCaptioningAppearance(DEFAULT_SUBTITLE_APPEARANCE);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual(DEFAULT_SUBTITLE_APPEARANCE);
  });
});

describe("openYoutube", () => {
  it("launches the TV's YouTube app with the video", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const calls = installBridge(() => ({ returnValue: true }));
    openYoutube("abc123");
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(calls[0].uri).toBe("luna://com.webos.applicationManager/launch");
    expect(calls[0].params).toEqual({ id: "youtube.leanback.v4", params: { contentTarget: "https://www.youtube.com/watch?v=abc123" } });
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the browser when the TV refuses the launch, or there is no bridge", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    installBridge(() => ({ returnValue: false, errorText: "no app" }));
    openYoutube("abc123");
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(open).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    openYoutube("abc123");
    expect(open).toHaveBeenCalledTimes(2);
  });
});
