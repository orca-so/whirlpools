import { execSync } from "child_process";
import { describe, it } from "vitest";

// FIXME: Renable this test when we remove stdlib from the wasm binary.

const WASM_SIZE_LIMIT = 25000; // 25KB

describe("WASM bundle size", () => {
  it.skip("Should be less than 25KB", () => {
    const output = execSync(
      "gzip -c dist/web/orca_whirlpools_core_js_bindings_bg.wasm | wc -c",
    ).toString();
    const size = parseInt(output);
    if (size > WASM_SIZE_LIMIT) {
      throw new Error(
        `Bundle size ${size} exceeds limit of ${WASM_SIZE_LIMIT}`,
      );
    }
  });
});
