import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    pool: "forks",
    minThreads: 1,
    maxThreads: 1,
    isolate: true,
    environment: "node",
    hookTimeout: 120000,
    teardownTimeout: 120000,
  },
});
