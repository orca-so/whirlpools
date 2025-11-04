import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 60000,

    // --- LiteSVM stability settings ---
    // Run tests sequentially — LiteSVM singleton is not thread-safe
    fileParallelism: false,
    maxConcurrency: 1,

    // Use a single forked process to avoid native memory duplication
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // all tests share one process
      },
    },

    // Avoid isolating test environments so the singleton persists cleanly
    isolate: false,
  },
});
