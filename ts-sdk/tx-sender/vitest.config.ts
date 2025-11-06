import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    pool: "forks",
    minThreads: 1,
    maxThreads: 1,
    isolate: true,
    hookTimeout: 120000,
    teardownTimeout: 120000,
  },
});
