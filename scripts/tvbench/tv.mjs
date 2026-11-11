// Shared helpers for the TV benchmarks: cold launch, attach to the TV's inspector, press keys.
//
// The TV's inspector listens on port 9998 while Developer Mode is on. Set TV_HOST to the TV's
// address. Needs Node 22, or Node 20.10+ run with --experimental-websocket.
import { execFile } from "node:child_process";

export const TV_HOST = process.env.TV_HOST;
export const DEVICE = process.env.WEBOS_DEVICE || "livingroom";
export const APP = process.env.WEBOS_APP_ID || "com.hopperapp.hopper";
if (!TV_HOST) { console.error("Set TV_HOST to the TV's address, for example TV_HOST=192.0.2.10"); process.exit(1); }

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = (cmd, args) => new Promise(resolve => execFile(cmd, args, { timeout: 60000 }, (_error, out, err) => resolve((out || "") + (err || ""))));

/** Close the app, launch it again and wait for it to settle. */
export async function coldLaunch(settleMs = 10000) {
  await run("ares-launch", ["--device", DEVICE, "--close", APP]);
  await sleep(2500);
  await run("ares-launch", ["--device", DEVICE, APP]);
  await sleep(settleMs);
}

/** Connect to the app's page over the Chrome DevTools Protocol. */
export async function attach() {
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    try {
      const targets = await (await fetch(`http://${TV_HOST}:9998/json`, { signal: AbortSignal.timeout(1500) })).json();
      page = targets.find(target => target.type === "page" && target.url.includes(APP));
    } catch { /* not up yet */ }
    if (!page) await sleep(200);
  }
  if (!page) throw new Error("The app's page was not found on the TV's inspector. Is the app running and Developer Mode on?");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    else listeners.forEach(listener => listener(message));
  });
  const send = (method, params = {}) => new Promise(resolve => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression, awaitPromise = false) => {
    const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 400));
    return reply.result?.result?.value;
  };
  const tv = { send, evaluate, on: listener => listeners.push(listener), close: () => { try { ws.close(); } catch { /* already closed */ } } };
  await evaluate(PRESS_JS);
  return tv;
}

// Injected into the page: press a remote key on the focused element and report what the main
// thread did in the next `settleMs` (handler time, frames drawn, longest gap, long tasks).
const PRESS_JS = `window.__press = function (key, code, settleMs) { return new Promise(function (resolve) {
  var target = document.activeElement || document.body; var frames = []; var longtasks = []; var observer = null;
  try { observer = new PerformanceObserver(function (list) { list.getEntries().forEach(function (e) { longtasks.push(Math.round(e.duration)); }); }); observer.observe({ entryTypes: ["longtask"] }); } catch (e) {}
  var t0 = performance.now();
  target.dispatchEvent(new KeyboardEvent("keydown", { key: key, keyCode: code, which: code, bubbles: true, cancelable: true }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key: key, keyCode: code, which: code, bubbles: true, cancelable: true }));
  var handler = performance.now() - t0; var running = true;
  requestAnimationFrame(function tick() { frames.push(performance.now() - t0); if (running) requestAnimationFrame(tick); });
  setTimeout(function () { running = false; if (observer) observer.disconnect(); var gaps = []; for (var i = 1; i < frames.length; i++) gaps.push(frames[i] - frames[i - 1]);
    var a = document.activeElement;
    resolve(JSON.stringify({ handler: Math.round(handler), firstFrame: Math.round(frames[0] || -1), frames: frames.length, maxGap: Math.round(Math.max.apply(null, gaps.concat([0]))), longtask: longtasks.reduce(function (s, d) { return s + d; }, 0), focus: (a && (a.getAttribute("aria-label") || a.className) || "").slice(0, 28) })); }, settleMs); }); };`;

export const KEYS = { right: ["ArrowRight", 39], left: ["ArrowLeft", 37], down: ["ArrowDown", 40], up: ["ArrowUp", 38], ok: ["Enter", 13], back: ["Escape", 27] };

/** Press a key by name (see KEYS) and return the measurements. */
export async function press(tv, name, settleMs = 700) {
  const [key, code] = KEYS[name];
  return JSON.parse(await tv.evaluate(`window.__press(${JSON.stringify(key)}, ${code}, ${settleMs})`, true));
}

/** Back out to Home and put focus on its first card. The app restores its last screen on launch. */
export async function goHome(tv) {
  for (let i = 0; i < 5 && !(await tv.evaluate("!!document.querySelector('main.home-screen') && !document.querySelector('.player-shell')")); i++) {
    await press(tv, "back", 600);
    await sleep(1500);
  }
  if (await tv.evaluate("!document.activeElement.classList.contains('media-card')")) {
    await tv.evaluate("document.querySelector('.home-rails .media-card')?.focus()");
    await sleep(600);
  }
}
