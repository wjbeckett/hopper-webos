import { describe, expect, it } from "vitest";
import { classicScriptsHtml } from "./classicScripts";

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
