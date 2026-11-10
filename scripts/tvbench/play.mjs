// Times playback start on the TV: from the OK press on Play to the first frame, with the video
// element's events and the network requests in between.
//
//   TV_HOST=<tv address> ROW=1 COL=0 node scripts/tvbench/play.mjs
//
// ROW and COL pick the Home card to open (0-based). A movie card opens Details with Play focused;
// an episode card opens the series page with the episode focused. Either way the next OK plays.
// This really plays the title for PLAY_MS (default 12 s), so it moves its resume position.
import { attach, coldLaunch, goHome, press, sleep } from "./tv.mjs";

await coldLaunch();
const tv = await attach();
await goHome(tv);
for (let i = 0; i < Number(process.env.ROW || 0); i++) await press(tv, "down", 400);
for (let i = 0; i < Number(process.env.COL || 0); i++) await press(tv, "right", 400);
const focus = () => tv.evaluate("(document.activeElement.getAttribute('aria-label') || document.activeElement.textContent || '').trim().slice(0, 40)");
console.log("Card:", await focus());
await press(tv, "ok", 400);
await sleep(4500);
console.log("Playing from:", await focus());

await tv.evaluate(`(() => { const log = window.__playLog = []; const t0 = performance.now(); const note = (name, extra) => log.push([name, Math.round(performance.now() - t0), extra || ""]);
  const hook = video => { if (video.__hooked) return; video.__hooked = true; note("video element");
    ["loadstart", "loadedmetadata", "loadeddata", "canplay", "playing", "waiting", "seeking", "seeked", "error"].forEach(name => video.addEventListener(name, () => note(name, "t=" + video.currentTime.toFixed(1) + " readyState=" + video.readyState)));
    let first = true; video.addEventListener("timeupdate", () => { if (first && video.currentTime > 0 && video.readyState >= 3) { first = false; note("first frame", "t=" + video.currentTime.toFixed(2)); } }); };
  new MutationObserver(() => { const video = document.querySelector("video"); if (video) hook(video); }).observe(document, { childList: true, subtree: true });
  const tasks = window.__playTasks = []; try { new PerformanceObserver(list => list.getEntries().forEach(e => tasks.push([Math.round(e.startTime - t0), Math.round(e.duration)]))).observe({ entryTypes: ["longtask"] }); } catch (e) {}
  const error = console.error; console.error = (...args) => { note("console.error", args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ").replace(/https?:\\/\\/[^\\s"]+/g, "<url>").slice(0, 160)); error(...args); }; return 1; })()`);

const requests = new Map();
tv.on(message => {
  const p = message.params;
  if (message.method === "Network.requestWillBeSent") requests.set(p.requestId, { url: p.request.url, method: p.request.method, start: p.timestamp });
  if (message.method === "Network.responseReceived" && requests.has(p.requestId)) Object.assign(requests.get(p.requestId), { status: p.response.status, firstByte: p.timestamp });
  if (message.method === "Network.loadingFinished" && requests.has(p.requestId)) Object.assign(requests.get(p.requestId), { end: p.timestamp, bytes: p.encodedDataLength });
});
await tv.send("Network.enable");
press(tv, "ok", 300);
await sleep(Number(process.env.PLAY_MS || 12000));
const log = JSON.parse(await tv.evaluate("JSON.stringify(window.__playLog)"));
const tasks = JSON.parse(await tv.evaluate("JSON.stringify(window.__playTasks)"));
await tv.send("Network.disable");
await press(tv, "back", 600);

console.log("Events (ms after the press):");
log.forEach(([name, at, extra]) => console.log(`  ${String(at).padStart(6)}  ${name}  ${extra}`));
console.log("Long tasks (start ms, length ms):", JSON.stringify(tasks.filter(task => task[0] >= 0)));
const list = [...requests.values()].sort((a, b) => a.start - b.start);
const first = list.length ? list[0].start : 0;
let segments = 0;
console.log("Requests (start ms, first byte ms, total ms, size):");
for (const request of list) {
  const path = request.url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*/, "").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<session>");
  if (/\/segment\/seg_/.test(path) && ++segments > 3) continue;
  const ms = value => value == null ? "-" : String(Math.round((value - request.start) * 1000));
  console.log(`  ${String(Math.round((request.start - first) * 1000)).padStart(6)} ${ms(request.firstByte).padStart(5)} ${ms(request.end).padStart(6)} ${String(request.bytes ? Math.round(request.bytes / 1024) : "-").padStart(6)} kB  ${request.status ?? "-"} ${request.method} ${path.slice(0, 90)}`);
}
tv.close();
setTimeout(() => process.exit(0), 300);
