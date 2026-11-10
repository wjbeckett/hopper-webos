// Home navigation benchmark. Cold-launches the app, then presses Right x6, Left x6, Down x4 and
// Up x4 twice (a cold pass and a warm pass), tracing each run in the TV's browser.
//
//   TV_HOST=<tv address> WEBOS_DEVICE=<name> node scripts/tvbench/home.mjs
//
// Each line gives, per key press: main-thread frames drawn in the 700 ms after the press (42 is
// every frame at 60 Hz), time to the first frame, long-task time, and main-thread time by kind.
// The frame count is inflated a little by the measurement itself, which requests every frame.
import { attach, coldLaunch, goHome, press, sleep } from "./tv.mjs";

const SETTLE_MS = 700;
const CATEGORIES = "devtools.timeline,disabled-by-default-devtools.timeline,blink,cc,gpu,toplevel,v8";
const COMPOSITING = ["GraphicsLayerUpdater::update", "CompositingInputsUpdater::update", "CompositingRequirementsUpdater::updateRecursive", "CompositingLayerAssigner::assign", "PaintArtifactCompositor::Update", "PaintLayer::UpdateDescendantDependentFlags", "LayerTreeHost::DoUpdateLayers", "UpdateLayer"];

/** Self time per event name per thread, in ms per key press. */
function summarise(events, keys) {
  const threadNames = new Map();
  const byThread = new Map();
  for (const event of events) {
    const thread = `${event.pid}:${event.tid}`;
    if (event.ph === "M" && event.name === "thread_name") threadNames.set(thread, event.args.name);
    if (event.ph === "X" && event.dur != null) { if (!byThread.has(thread)) byThread.set(thread, []); byThread.get(thread).push(event); }
  }
  const totals = new Map();
  let rasterTasks = 0;
  for (const [thread, list] of byThread) {
    const name = threadNames.get(thread) || thread;
    list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    const stack = [];
    for (const event of list) {
      while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= event.ts) stack.pop();
      if (stack.length) stack[stack.length - 1].child = (stack[stack.length - 1].child || 0) + event.dur;
      stack.push(event);
    }
    const sums = totals.get(name) || new Map();
    for (const event of list) {
      sums.set(event.name, (sums.get(event.name) || 0) + event.dur - Math.min(event.child || 0, event.dur));
      if (event.name === "RasterTask") rasterTasks += 1;
    }
    totals.set(name, sums);
  }
  const main = totals.get("CrRendererMain") || new Map();
  const ms = (sums, names) => Math.round(names.reduce((sum, name) => sum + (sums.get(name) || 0), 0) / 1000 / keys);
  const all = sums => Math.round([...sums.values()].reduce((sum, value) => sum + value, 0) / 1000 / keys);
  const raster = [...totals].filter(([name]) => name.startsWith("CompositorTileWorker")).reduce((sum, [, sums]) => sum + all(sums), 0);
  return `main ${all(main)} ms [js ${ms(main, ["V8.Execute", "v8.callFunction", "FunctionCall"])}, commit ${ms(main, ["ProxyMain::BeginMainFrame::commit"])}, compositing ${ms(main, COMPOSITING)}, paint ${ms(main, ["Paint", "LocalFrameView::RunPaintLifecyclePhase"])}, style ${ms(main, ["Document::recalcStyle"])}, layout ${ms(main, ["LocalFrameView::performLayout", "Layout"])}] | gpu ${all(totals.get("Chrome_InProcGpuThread") || new Map())} | raster ${raster} (${Math.round(rasterTasks / keys)} tasks)`;
}

await coldLaunch();
const tv = await attach();
await goHome(tv);

let layers = null;
tv.on(message => { if (message.method === "LayerTree.layerTreeDidChange" && message.params.layers) layers = message.params.layers.length; });
await tv.send("LayerTree.enable"); await sleep(800); await tv.send("LayerTree.disable");
console.log(`Home: ${await tv.evaluate("document.querySelectorAll('.media-card').length")} cards mounted, ${await tv.evaluate("document.querySelectorAll('*').length")} elements, ${layers} compositor layers`);

async function trace(label, name, count) {
  const events = [];
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  tv.on(message => {
    if (message.method === "Tracing.dataCollected") events.push(...message.params.value);
    if (message.method === "Tracing.tracingComplete") finish();
  });
  await tv.send("Tracing.start", { categories: CATEGORIES, transferMode: "ReportEvents" });
  await sleep(200);
  const rows = [];
  for (let i = 0; i < count; i++) rows.push(await press(tv, name, SETTLE_MS));
  await tv.send("Tracing.end");
  await done;
  const average = key => Math.round(rows.reduce((sum, row) => sum + row[key], 0) / rows.length);
  console.log(`${label} ${name} x${count}: ${average("frames")} frames/key, first frame ${average("firstFrame")} ms, long tasks ${average("longtask")} ms/key, ends on "${rows[rows.length - 1].focus}"`);
  console.log(`    ${summarise(events, rows.length)}`);
}

for (const pass of ["cold", "warm"]) {
  await trace(pass, "right", 6);
  await trace(pass, "left", 6);
  await trace(pass, "down", 4);
  await trace(pass, "up", 4);
}
tv.close();
setTimeout(() => process.exit(0), 300);
