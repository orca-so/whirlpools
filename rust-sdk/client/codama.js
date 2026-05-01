import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { getRenderMapVisitor } from "@codama/renderers-rust";
import { createFromRoot, mapVisitor, updateAccountsVisitor } from "codama";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const OUTPUT_DIR = "./src/generated";

const idl = JSON.parse(readFileSync("../../target/idl/whirlpool.json", "utf8"));
const codama = createFromRoot(rootNodeFromAnchor(idl));

codama.update(
  updateAccountsVisitor({
    TickArray: {
      name: "FixedTickArray",
    },
  }),
);

// Codama's Rust renderer hardcodes `crate::WHIRLPOOL_ID` into instruction
// builders and account `Owner` impls. We rewrite those to call the runtime
// selector (`crate::current_whirlpool_id()`, defined in `src/program_id.rs`)
// so the same SDK can target the canonical, immutable, or any forked
// Whirlpool deployment without recompiling.
const REWRITES = [
  [
    "program_id: crate::WHIRLPOOL_ID,",
    "program_id: crate::current_whirlpool_id(),",
  ],
  [
    "fn owner() -> Pubkey {\n        crate::WHIRLPOOL_ID\n      }",
    "fn owner() -> Pubkey {\n        crate::current_whirlpool_id()\n      }",
  ],
];

const rewrite = (content) =>
  REWRITES.reduce((acc, [from, to]) => acc.split(from).join(to), content);

// Wrap the renderer's render map in a mapVisitor that applies the rewrites
// before any files hit disk — keeps the dispatch transformation inside the
// codama pipeline instead of a separate post-render step.
const renderVisitor = mapVisitor(getRenderMapVisitor({}), (renderMap) => {
  const out = new Map();
  for (const [path, content] of renderMap.entries()) {
    out.set(path, rewrite(content));
  }
  return out;
});

const renderMap = codama.accept(renderVisitor);

rmSync(OUTPUT_DIR, { recursive: true, force: true });
for (const [relPath, content] of renderMap.entries()) {
  const fullPath = join(OUTPUT_DIR, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}
