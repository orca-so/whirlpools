import assert from "assert";
import { exec } from "child_process";
import { readdirSync } from "fs";
import { describe, it } from "vitest";

const commandTemplates = [
  "tsx ./index.ts --tsconfig {}",
  "ts-node ./index.ts --tsconfig {}",
  "tsc --tsconfig {} --outDir ./dist && node ./dist/index.js"
]

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
      it(`Run using '${command}'`, async () => {
        const stdout = await execute(command);
        assert(stdout.includes("Whirlpools"));
      });
    });
  });
});
