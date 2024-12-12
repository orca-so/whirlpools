import assert from "assert";
import { execSync } from "child_process";
import { readdirSync } from "fs";
import { describe, it } from "vitest";

const clientConfigs = readdirSync("./client");
const coreConfigs = readdirSync("./core");
const whirlpoolConfigs = readdirSync("./whirlpool");

function exec(command: string) {
  try {
    return execSync(command);
  } catch (error) {
    assert.fail(`${error}`);
  }
}

describe("Integration", () => {
  clientConfigs.forEach((config) => {
    it.concurrent(`Build client using ${config}`, () => {
      exec(`cargo check --manifest-path './client/${config}/Cargo.toml'`);
    });
  });

  coreConfigs.forEach((config) => {
    it.concurrent(`Build core using ${config}`, () => {
      exec(`cargo check --manifest-path './core/${config}/Cargo.toml'`);
    });
  });

  whirlpoolConfigs.forEach((config) => {
    it.concurrent(`Build whirlpool using ${config}`, () => {
      exec(`cargo check --manifest-path './whirlpool/${config}/Cargo.toml'`);
    });
  });
});
