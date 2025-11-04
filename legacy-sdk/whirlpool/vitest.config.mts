import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 60000,
    exclude: [
      // Exclude heavy Token-2022 suites that require full mainnet binary
      "tests/integration/token-extensions/interest-bearing.test.ts",
      "tests/integration/token-extensions/scaled-ui-amount.test.ts",
    ],
  },
});
