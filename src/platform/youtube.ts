type WebOSBridge = {
  service?: { request: (uri: string, options: { method: string; parameters: Record<string, unknown>; onFailure?: () => void }) => void };
};

export function openYoutube(videoKey: string) {
  const target = `https://www.youtube.com/watch?v=${encodeURIComponent(videoKey)}`;
  const bridge = (window as unknown as { webOS?: WebOSBridge }).webOS;
  if (bridge?.service) {
    bridge.service.request("luna://com.webos.applicationManager", {
      method: "launch",
      parameters: { id: "youtube.leanback.v4", params: { contentTarget: target } },
      onFailure: () => { window.open(target, "_blank"); }
    });
    return;
  }
  window.open(target, "_blank");
}
