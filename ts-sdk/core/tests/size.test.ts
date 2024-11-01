import { execSync } from "child_process";
import { describe, it } from "vitest";

// FIXME: Renable this test when we remove stdlib from the wasm binary.

const WASM_SIZE_LIMIT = 25000; // 25KB

describe("Bundle size", () => {
  it.skip("nodejs", () => {
    const output = execSync(
      "gzip -c dist/nodejs/orca_whirlpools_core_js_bindings_bg.wasm | wc -c",
    ).toString();
    const size = parseInt(output);
    if (size > WASM_SIZE_LIMIT) {
      throw new Error(
        `Bundle size ${size} exceeds limit of ${WASM_SIZE_LIMIT}`,
      );
    }
  });

  it.skip("browser", () => {
    const output = execSync(
      "gzip -c dist/browser/orca_whirlpools_core_js_bindings_bg.wasm | wc -c",
    ).toString();
    const size = parseInt(output);
    if (size > WASM_SIZE_LIMIT) {
      throw new Error(
        `Bundle size ${size} exceeds limit of ${WASM_SIZE_LIMIT}`,
      );
    }
  });
});
