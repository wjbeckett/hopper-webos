import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { flexGapFallback } from "./src/platform/flexGapFallback";

/**
 * Every build gets its own version, so a TV can always say which build it is running.
 *
 * The version is <major>.<minor> from package.json plus the number of commits on the
 * branch being built: 0.3.412. LG requires three numeric parts, and a count only goes up.
 * The commit hash goes alongside for exact identification, with "+" when the working tree
 * has uncommitted changes. Without git (a source archive) it falls back to package.json.
 */
function buildVersion() {
  const base = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")).version as string;
  const git = (command: string) => execSync(`git ${command}`, { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  try {
    const [major, minor] = base.split(".");
    const commit = git("rev-parse --short HEAD") + (git("status --porcelain") ? "+" : "");
    return { version: `${major}.${minor}.${git("rev-list --count HEAD")}`, commit };
  } catch {
    return { version: base, commit: "" };
  }
}

const build = buildVersion();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(build.version),
    __APP_COMMIT__: JSON.stringify(build.commit)
  },
  plugins: [
    react(),
    {
      // Stamp the packaged manifest, which is what the TV's app list and ares-install report.
      name: "hopper-appinfo-version",
      apply: "build",
      closeBundle() {
        const file = resolve(__dirname, "dist/appinfo.json");
        const appinfo = JSON.parse(readFileSync(file, "utf8"));
        appinfo.version = build.version;
        writeFileSync(file, `${JSON.stringify(appinfo, null, 2)}\n`);
      }
    },
    {
      // The stand-in for flex gap on Chrome 79 (webOS 6), loaded only there (platform/flexGap.ts).
      name: "hopper-flex-gap-fallback",
      apply: "build",
      generateBundle(_options, bundle) {
        const css = Object.values(bundle).filter(file => file.type === "asset" && file.fileName.endsWith(".css"));
        if (css.length !== 1) this.error(`expected one stylesheet in the bundle, found ${css.length}`);
        const source = (css[0] as { source: string | Uint8Array }).source;
        this.emitFile({ type: "asset", fileName: "flex-gap.css", source: flexGapFallback(typeof source === "string" ? source : new TextDecoder().decode(source)) });
      }
    },
    {
      name: "hopper-client-log",
      configureServer(server) {
        server.middlewares.use("/__client-log", (request, response) => {
          if (request.method !== "POST") {
            response.statusCode = 405;
            response.end();
            return;
          }
          let body = "";
          request.on("data", (chunk) => { body += String(chunk); });
          request.on("end", () => {
            console.error(`[Hopper client] ${body}`);
            response.statusCode = 204;
            response.end();
          });
        });
      }
    }
  ],
  base: "./",
  server: {
    proxy: {
      "/__silo": {
        target: process.env.SILO_DEV_SERVER,
        changeOrigin: true,
        secure: false,
        ws: true,
        rewrite: (path) => path.replace(/^\/__silo/, ""),
        configure: (proxy) => {
          proxy.on("proxyReqWs", (proxyReq) => {
            proxyReq.setHeader("Origin", process.env.SILO_DEV_SERVER);
          });
        }
      }
    }
  },
  build: {
    // webOS 6 (Chrome 79) is the oldest supported TV. esbuild lowers newer syntax (optional
    // chaining, ??) and simple CSS such as `inset: 0` for it; see docs/DECISIONS.md.
    target: "chrome79",
    outDir: "dist",
    emptyOutDir: true
  }
});
