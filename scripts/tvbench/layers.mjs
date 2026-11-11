// Lists the compositor layers of whatever screen the app is showing on the TV, with the reason
// each one exists. Layer count and layer area are what a slow screen usually has too much of.
//
//   TV_HOST=<tv address> node scripts/tvbench/layers.mjs
import { attach, sleep } from "./tv.mjs";

const tv = await attach();
let layers = null;
tv.on(message => { if (message.method === "LayerTree.layerTreeDidChange" && message.params.layers) layers = message.params.layers; });
await tv.send("DOM.enable");
await tv.send("LayerTree.enable");
await sleep(1500);
if (!layers) { console.log("The TV sent no layer tree. Move focus once and try again."); process.exit(1); }

const counts = new Map();
const rows = [];
for (const layer of layers) {
  const reply = await tv.send("LayerTree.compositingReasons", { layerId: layer.layerId });
  const why = (reply.result?.compositingReasonIds || reply.result?.compositingReasons || []).join("+") || "(none)";
  let node = "";
  if (layer.backendNodeId) {
    const described = (await tv.send("DOM.describeNode", { backendNodeId: layer.backendNodeId })).result?.node;
    if (described) {
      const attributes = described.attributes || [];
      const at = attributes.indexOf("class");
      node = described.nodeName.toLowerCase() + (at >= 0 ? "." + attributes[at + 1].split(" ").slice(0, 2).join(".") : "");
    }
  }
  rows.push({ why, node, width: layer.width, height: layer.height, draws: layer.drawsContent });
  counts.set(`${why} | ${node}`, (counts.get(`${why} | ${node}`) || 0) + 1);
}
const drawing = rows.filter(row => row.draws);
console.log(`${rows.length} layers, ${drawing.length} drawing, ${Math.round(drawing.reduce((sum, row) => sum + row.width * row.height * 4, 0) / 1e6)} MB of layer area`);
[...counts].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([key, count]) => console.log(String(count).padStart(4), key));
console.log("Largest:");
drawing.sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 10).forEach(row => console.log(`  ${row.width}x${row.height} ${row.node} | ${row.why}`));
tv.close();
setTimeout(() => process.exit(0), 300);
