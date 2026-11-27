import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classicScriptsHtml, patchSystem } from "./classicScripts";

const built = `<!doctype html>
<html>
  <head>
    <script type="module" crossorigin src="./assets/index-abc.js"></script>
    <link rel="modulepreload" crossorigin href="./assets/icons-def.js">
    <link rel="stylesheet" crossorigin href="./assets/style-123.css">
  </head>
  <body>
    <div id="root"></div>
    <script>startSplash();</script>
  </body>
</html>`;

const loader = "/*! SJS */!function(){window.System={}}();";

describe("classicScriptsHtml (#223)", () => {
  it("loads the entry with plain scripts after the page, and drops crossorigin", () => {
    const page = classicScriptsHtml(built, loader);
    const tags = page.replace(/<script>[\s\S]*?<\/script>/g, "<script></script>");
    expect(tags).not.toMatch(/type="module"|crossorigin|modulepreload/);
    expect(page).toContain('<link rel="stylesheet" href="./assets/style-123.css">');
    const loaderAt = page.indexOf(loader);
    expect(loaderAt).toBeGreaterThan(page.indexOf("startSplash();"));
    expect(page.indexOf('System.import("./assets/index-abc.js");')).toBeGreaterThan(loaderAt);
    expect(page.indexOf("</body>")).toBeGreaterThan(page.indexOf("System.import"));
  });

  it("fails the build rather than ship a page that can't start on webOS 6", () => {
    expect(() => classicScriptsHtml(built.replace(/<script type="module"[^\n]*\n/, ""), loader)).toThrow(/one entry script/);
    expect(() => classicScriptsHtml(built.replace("<body>", "<body><img crossorigin src=x>"), loader)).toThrow(/crossorigin/);
    expect(() => classicScriptsHtml(built, "x</script>y")).toThrow(/inlined/);
  });
});

describe("patchSystem retry after a failed load (#208, #223)", () => {
  // The real SystemJS minimal loader, with instantiate replaced so the test decides which files
  // exist. Each module counts its executions, so a module that loaded is seen to stay loaded.
  function loader() {
    (window as any).System = undefined;
    window.eval(readFileSync(resolve(__dirname, "../../node_modules/systemjs/dist/s.js"), "utf8"));
    const System = (window as any).System;
    patchSystem();
    const missing = new Set<string>();
    const runs: Record<string, number> = {};
    const graph: Record<string, string[]> = { screen: ["shared", "core"], shared: ["leaf", "core"], leaf: [], core: [] };
    System.resolve = (id: string) => `app:${id.replace(/^app:/, "")}`;
    System.instantiate = (url: string) => {
      const name = url.slice(4);
      if (missing.has(name)) throw new Error(`no ${name}`);
      return [graph[name], (_export: (key: string, value: unknown) => void) => ({
        setters: graph[name].map(() => () => {}),
        execute() { runs[name] = (runs[name] || 0) + 1; _export("name", name); }
      })];
    };
    return { System, missing, runs };
  }

  it("loads screen -> shared -> leaf again once the missing leaf is back", async () => {
    const { System, missing, runs } = loader();
    await System.import("core");
    missing.add("leaf");
    await expect(System.import("screen")).rejects.toThrow(/no leaf/);
    await expect(System.import("screen")).rejects.toThrow(/no leaf/);
    missing.delete("leaf");
    await expect(System.import("screen")).resolves.toMatchObject({ name: "screen" });
    expect(runs).toEqual({ core: 1, leaf: 1, shared: 1, screen: 1 });
  });

  it("loads a screen again once its own file is back", async () => {
    const { System, missing } = loader();
    missing.add("screen");
    await expect(System.import("screen")).rejects.toThrow(/no screen/);
    missing.delete("screen");
    await expect(System.import("screen")).resolves.toMatchObject({ name: "screen" });
  });
});
