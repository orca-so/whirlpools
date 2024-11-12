import { readdirSync } from "fs";
import { promptChoice } from "./utils/prompt";
import { toSnakeCase } from "js-convert-case";

const commands = readdirSync("./src/commands")
  .filter((file) => file.endsWith(".ts"))
  .map((file) => file.replace(".ts", ""))
  .map((file) => ({
    title: file,
    value: () => import(`./commands/${file}.ts`),
  }));

const arg = toSnakeCase(process.argv[2]);

const maybeCommand = commands.find((c) => c.title === arg);
if (maybeCommand) {
  await maybeCommand.value();
} else {
  const command = await promptChoice("command", commands);
  await command();
}
