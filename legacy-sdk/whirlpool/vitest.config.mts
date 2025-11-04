import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 60000,
    exclude: [
      "tests/integration/token-extensions/interest-bearing.test.ts",
      "tests/integration/token-extensions/scaled-ui-amount.test.ts",
    ],

    // --- LiteSVM stability settings ---
    // Run tests sequentially — LiteSVM singleton is not thread-safe
    fileParallelism: false,
    maxConcurrency: 1,

    // Use threads to share address space and reduce native duplication
    pool: "threads",
    poolOptions: {},

    // Keep default isolation; sequential + threads should suffice
  },
});
