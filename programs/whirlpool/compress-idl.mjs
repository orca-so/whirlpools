#!/usr/bin/env node
/**
 * CLI: Strips docs from the Anchor IDL and compresses with zlib.
 *
 * Usage:
 *   compress-idl.mjs [options]
 *
 * Defaults:
 *   input:  ../../target/idl/whirlpool.json
 *   output: ../../target/idl/whirlpool-compressed.json.gz
 *
 * Options:
 *   -i, --input <file>      Input IDL JSON
 *   -o, --output <file>     Output file
 *   -l, --level <0-9>      Zlib compression level (default: 6)
 *   -h, --help              Show this help
 */

import { readFileSync, writeFileSync } from "fs";
import { deflateSync } from "zlib";

function stripDocs(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => stripDocs(item));
  }
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "docs") continue;
    result[key] = stripDocs(value);
  }
  return result;
}

const DEFAULT_INPUT = "../../target/idl/whirlpool.json";
const DEFAULT_OUTPUT = "../../target/idl/whirlpool-compressed.json.gz";
const DEFAULT_LEVEL = 6;

function showHelp() {
  console.log(
    `
Compress IDL: strip docs and compress with zlib (level 6)

Usage:
  compress-idl.mjs [options]

Defaults:
  input:   ${DEFAULT_INPUT}
  output:  ${DEFAULT_OUTPUT}
  level:   ${DEFAULT_LEVEL}

Options:
  -i, --input <file>      Input IDL JSON (default: ${DEFAULT_INPUT})
  -o, --output <file>     Output file (default: ${DEFAULT_OUTPUT})
  -l, --level <0-9>      Zlib compression level (default: ${DEFAULT_LEVEL})
  -h, --help              Show this help

Examples:
  compress-idl.mjs
  compress-idl.mjs -i target/idl/whirlpool.json -o out.idl
`.trim(),
  );
}

const args = process.argv.slice(2);
let input = null;
let output = null;
let level = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "-h" || arg === "--help") {
    showHelp();
    process.exit(0);
  }
  if (arg === "-i" || arg === "--input") {
    input = args[++i];
    continue;
  }
  if (arg === "-o" || arg === "--output") {
    output = args[++i];
    continue;
  }
  if (arg === "-l" || arg === "--level") {
    level = parseInt(args[++i], 10);
    continue;
  }
}

if (!input) input = DEFAULT_INPUT;
if (!output) output = DEFAULT_OUTPUT;
if (level == null || isNaN(level)) level = DEFAULT_LEVEL;
if (level < 0 || level > 9) {
  console.error("Error: -l, --level must be 0-9.");
  process.exit(1);
}

const json = JSON.parse(readFileSync(input, "utf8"));
const stripped = stripDocs(json);
const jsonStr = JSON.stringify(stripped);
const compressed = deflateSync(Buffer.from(jsonStr, "utf8"), { level });
writeFileSync(output, compressed);
