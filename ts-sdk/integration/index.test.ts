import assert from "assert";
import { exec } from "child_process";
import { readdirSync } from "fs";
import { describe, it } from "vitest";

const commandTemplates = [
  "tsx --tsconfig {} ./index.ts",
  "tsc --project {} --outDir ./dist && node ./dist/index.js",
  // FIXME: ts-node does not play nice with ESM since node 20
  // "ts-node --esm --project {} ./index.ts",
]

// commonjs not included here because wasm wouldn't support it
const tsConfigs = readdirSync("./configs");

function execute(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout) => {
      if (error) return reject(error);
      resolve(stdout);
    });
  });
}

describe("Integration", () => {
  commandTemplates.forEach(template => {
    tsConfigs.forEach(config => {
      const command = template.replace("{}", `./configs/${config}`);
      it(`Use '${command}'`, async () => {
        const stdout = await execute(command);
        assert(stdout.includes("Whirlpools"));
      });
    });
  });
});
