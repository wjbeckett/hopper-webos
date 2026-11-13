import { lunaAvailable, lunaCall } from "./luna";

export function openYoutube(videoKey: string) {
  const target = `https://www.youtube.com/watch?v=${encodeURIComponent(videoKey)}`;
  if (!lunaAvailable()) {
    window.open(target, "_blank");
    return;
  }
  // Opens the browser only when the TV refuses the launch (no YouTube app). A slow answer is
  // left alone, so a launch that is still starting doesn't also open the browser.
  void lunaCall("luna://com.webos.applicationManager/launch", { id: "youtube.leanback.v4", params: { contentTarget: target } }, 10000)
    .then(reply => { if (reply?.returnValue === false) window.open(target, "_blank"); });
}
