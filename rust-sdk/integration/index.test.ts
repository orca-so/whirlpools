import assert from "assert";
import { execSync } from "child_process";
import { readdirSync } from "fs";
import { describe, it } from "vitest";

const clientConfigs = readdirSync("./client");
const coreConfigs = readdirSync("./core");
const whirlpoolConfigs = readdirSync("./whirlpool");

function exec(...command: string[]) {
  try {
    return execSync(command.join(" && ")).toString();
  } catch (error) {
    assert.fail(`${error}`);
  }
}

function check(path: string) {
  const versions = exec(`awk '/version = "[^"]*"/' '${path}/Cargo.toml'`);
  exec(`cargo generate-lockfile --manifest-path '${path}/Cargo.toml'`);
  for (const version of versions.split("\n")) {
    const match = version.match(
      /([a-zA-Z0-9-_]+)\s*=\s*{\s*version\s*=\s*"~([^"]+)"/,
    );
    if (!match) continue;
    const rawExistingVersions = exec(
      `awk '/"${match[1]} [0-9]+.[0-9]+.[0-9]+"/' '${path}/Cargo.lock'`,
    );
    const existingVersions = new Set(
      rawExistingVersions.split("\n").filter((x) => x),
    );
    for (const existingVersion of existingVersions) {
      const specifier = existingVersion.slice(2, -2).replaceAll(" ", ":");
      exec(
        `cargo update ${specifier} --precise ${match[2]} --manifest-path '${path}/Cargo.toml'`,
      );
    }
  }
  exec(`cargo check --manifest-path '${path}/Cargo.toml' --locked`);
}

describe("Integration", () => {
  clientConfigs.forEach((config) => {
    it(`Build client using ${config}`, () => check(`./client/${config}`));
  });

  coreConfigs.forEach((config) => {
    it(`Build core using ${config}`, () => check(`./core/${config}`));
  });

  whirlpoolConfigs.forEach((config) => {
    it(`Build whirlpool using ${config}`, () => check(`./whirlpool/${config}`));
  });
});
