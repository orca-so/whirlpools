import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { getRenderMapVisitor } from "@codama/renderers-rust";
import {
  deleteDirectory,
  mapRenderMapContent,
  writeRenderMap,
} from "@codama/renderers-core";
import { createFromRoot, updateAccountsVisitor } from "codama";
import { readFileSync } from "fs";

const idl = JSON.parse(readFileSync("../../target/idl/whirlpool.json", "utf8"));
const codama = createFromRoot(rootNodeFromAnchor(idl));
codama.update(
  updateAccountsVisitor({
    TickArray: { name: "FixedTickArray" },
  }),
);

const renderMap = codama.accept(getRenderMapVisitor());

// Replace just the body of the `Owner` impl across every generated file.
const ownerImplRe =
  /(impl anchor_lang::Owner for \w+ \{\s*fn owner\(\) -> Pubkey \{\s*)crate::\w+_ID(\s*\}\s*\})/g;

const patched = mapRenderMapContent(renderMap, (content) =>
  content.replace(
    ownerImplRe,
    '$1unimplemented!("fetch account via rpc to determine owner")$2',
  ),
);

const outDir = "./src/generated";
deleteDirectory(outDir);
writeRenderMap(patched, outDir);
