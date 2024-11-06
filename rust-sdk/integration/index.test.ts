import assert from "assert";
import { execSync } from "child_process";
import { existsSync, rmSync } from "fs";
import { describe, it, beforeEach } from "vitest";

type RustConfig = {
  solana: string;
  anchor?: string;
};

// Make sure client package work with a wide range of solana/anchor versions
const rustConfigs: RustConfig[] = [
  { solana: "1.17.11" },
  { solana: "1.18.26" },
  { solana: "1.17.11", anchor: "0.29.0" },
  { solana: "1.18.26", anchor: "0.30.1" },
];

describe("Integration", () => {

  beforeEach(() => {
    if (existsSync("Cargo.lock")) {
      rmSync("Cargo.lock");
    }
  })

  rustConfigs.forEach((config) => {
    it(`Build using '${JSON.stringify(config)}'`, () => {
      let features = "";
      if (config.anchor) {
        features = `--features anchor`;
        execSync(`cargo update anchor-lang --precise ${config.anchor}`);
      }
      execSync(`cargo update solana-program --precise ${config.solana}`);

      const output = execSync(`cargo run ${features}`).toString();
      assert(output.includes("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"));
    });
  });
});
