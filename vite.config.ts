import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "silo-client-diagnostics",
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
            console.error(`[Silo webOS client] ${body}`);
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
    target: "es2020",
    outDir: "dist",
    emptyOutDir: true
  }
});
