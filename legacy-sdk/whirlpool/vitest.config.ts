import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 60000,
    // Run litesvm tests sequentially to avoid worker crashes
    // LiteSVM uses a singleton pattern that doesn't support parallel execution
    fileParallelism: false,
    maxConcurrency: 1,
  },
});
