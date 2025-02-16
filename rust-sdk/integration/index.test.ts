import assert from "assert";
import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "fs";
import { describe, it } from "vitest";
import { parse } from "smol-toml";
import { coerce } from "semver";

type Cargofile = {
  dependencies: Record<string, string | { version?: string }>;
};

type Lockfile = {
  package: {
    name: string;
    version: string;
  }[];
};

function configs(path: string) {
  return readdirSync(path).filter((folder) =>
    existsSync(`${path}/${folder}/Cargo.toml`),
  );
}

const clientConfigs = configs("./client");
const coreConfigs = configs("./core");
const whirlpoolConfigs = configs("./whirlpool");

function exec(...command: string[]) {
  try {
    return execSync(command.join(" ")).toString();
  } catch (error) {
    assert.fail(`${error}`);
  }
}

function normalizeVersion(version: string) {
  return coerce(version)?.version ?? version;
}

function getOverwrites(path: string): Map<string, string> {
  const toml = parse(readFileSync(`${path}/Cargo.toml`, "utf-8")) as Cargofile;
  const overwrites: Map<string, string> = new Map();
  for (const [name, spec] of Object.entries(toml.dependencies)) {
    if (typeof spec === "string") {
      overwrites.set(name, normalizeVersion(spec));
    }
    if (typeof spec === "object" && spec.version) {
      overwrites.set(name, normalizeVersion(spec.version));
    }
  }
  return overwrites;
}

function findExistingVersions(path: string, name: string): Set<string> {
  const toml = parse(readFileSync(`${path}/Cargo.lock`, "utf-8")) as Lockfile;
  const existingVersions: Set<string> = new Set();
  for (const dep of toml.package) {
    if (dep.name !== name) continue;
    existingVersions.add(normalizeVersion(dep.version));
  }
  return existingVersions;
}

function check(path: string) {
  const overwrites = getOverwrites(path);
  console.log(overwrites)
  if (existsSync(`${path}/Cargo.lock`)) {
    rmSync(`${path}/Cargo.lock`);
  }
  exec(`cargo generate-lockfile --manifest-path '${path}/Cargo.toml'`);
  for (const [name, version] of overwrites) {
    const existingVersions = findExistingVersions(path, name);
    existingVersions.delete(version);
    for (const existingVersion of existingVersions) {
      console.log(`cargo update ${name}:${existingVersion} --precise ${version} --manifest-path '${path}/Cargo.toml'`,)
      exec(
        `cargo update ${name}:${existingVersion} --precise ${version} --manifest-path '${path}/Cargo.toml'`,
      );
    }
  }
  exec(`cargo check --manifest-path '${path}/Cargo.toml' --locked`);
}

describe("Integration", () => {
  // clientConfigs.forEach((config) => {
  //   it(`Build client using ${config}`, () => check(`./client/${config}`));
  // });

  // coreConfigs.forEach((config) => {
  //   it(`Build core using ${config}`, () => check(`./core/${config}`));
  // });

  whirlpoolConfigs.forEach((config) => {
    it(`Build whirlpool using ${config}`, () => check(`./whirlpool/${config}`));
  });
});
