// @ts-nocheck
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    pool: "forks",
    environment: "node",
    silent: true,
  },
});
