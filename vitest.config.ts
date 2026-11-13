import { defineConfig } from "vitest/config";

// Unit tests (`npm test`). They run in jsdom, not on a TV: they check logic, not what a TV draws.
export default defineConfig({
  // Stamped by vite.config.ts in a real build.
  define: { __APP_VERSION__: JSON.stringify("0.0.0-test"), __APP_COMMIT__: JSON.stringify("test") },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    restoreMocks: true
  }
});
