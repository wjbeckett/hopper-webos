/**
 * webOS 6 (Chrome 79) won't load an installed app's own files in CORS mode (#223). An installed
 * app's page is a file:// page, and Chrome 79 allows CORS requests only to http(s), data and
 * chrome URLs, so `<script type="module">` and any tag with `crossorigin` are blocked there. The
 * page then stays on the splash for good: the splash is inline, the app never starts. webOS 22
 * allows those loads.
 *
 * So the build emits SystemJS chunks (vite.config.ts) and this rewrites the built index.html to load
 * them with plain scripts: the SystemJS loader inline, then `System.import` of the entry at the end
 * of <body>, where the deferred module script used to run, after the document is parsed. Lazy
 * screens and hls.js are still separate files, which SystemJS loads with plain script tags.
 */

const MODULE_SCRIPT = /[ \t]*<script type="module" crossorigin src="([^"]+)"><\/script>\n?/g;
const MODULE_PRELOAD = /[ \t]*<link rel="modulepreload"[^>]*>\n?/g;

/**
 * Two changes to SystemJS, run in the page right after it. ES5, for Chrome 79.
 *
 * - SystemJS marks a chunk crossorigin unless its URL starts with `location.origin + "/"`. An
 *   installed webOS app's origin need not match its file:///media/... path, and every chunk is the
 *   app's own file, so none is ever loaded crossorigin.
 * - SystemJS keeps a failed load in its registry and hands the same failure to every later import,
 *   where a native dynamic import tries the file again. Lazy screens retry a failed load (#208), so
 *   a failure removes the failed files from the registry, and every entry that depends on one.
 */
function patchSystem() {
  /* eslint-disable */
  var System = (window as any).System;
  var proto = System.constructor.prototype;
  var createScript = proto.createScript;
  proto.createScript = function (this: unknown, url: string) {
    var script = createScript.call(this, url);
    script.removeAttribute("crossorigin");
    return script;
  };
  var load = proto.import;
  proto.import = function (this: any, id: string, parentUrl?: unknown) {
    var loader = this;
    return load.apply(loader, arguments).catch(function (error: unknown) {
      var keys = Object.getOwnPropertySymbols ? Object.getOwnPropertySymbols(loader) : [];
      var registry = loader[keys.length ? keys[0] : "@"];
      var failed: Record<string, boolean> = {};
      try { failed[loader.resolve(id, typeof parentUrl === "string" ? parentUrl : undefined)] = true; } catch (_) { /* unresolvable: nothing was registered */ }
      for (var changed = true; changed && registry;) {
        changed = false;
        for (var key in registry) {
          var entry = registry[key];
          if (failed[key] || entry.er || (entry.d && entry.d.some(function (dep: { id: string }) { return failed[dep.id]; }))) {
            delete registry[key];
            failed[key] = changed = true;
          }
        }
      }
      throw error;
    });
  };
}

const SYSTEM_PATCH = `(${patchSystem.toString()})();`;

export function classicScriptsHtml(html: string, loader: string) {
  if (/<\/script/i.test(loader)) throw new Error("classic scripts: the loader can't be inlined");
  const entries: string[] = [];
  let page = html.replace(MODULE_SCRIPT, (_tag, src: string) => {
    entries.push(src);
    return "";
  });
  if (entries.length !== 1) throw new Error(`classic scripts: expected one entry script, found ${entries.length}`);
  page = page.replace(MODULE_PRELOAD, "").replace(/(<link rel="stylesheet")\s+crossorigin(?:="[^"]*")?/g, "$1");
  if (/type="module"|\bcrossorigin\b/i.test(page)) throw new Error("classic scripts: a module script or crossorigin tag is left in index.html");
  const end = page.lastIndexOf("</body>");
  if (end < 0) throw new Error("classic scripts: no </body>");
  const scripts = `    <script>${loader.trim()}\n${SYSTEM_PATCH}\nSystem.import(${JSON.stringify(entries[0])});</script>\n  `;
  return page.slice(0, end) + scripts + page.slice(end);
}
