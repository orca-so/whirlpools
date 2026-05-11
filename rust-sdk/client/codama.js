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

// Inject a doc comment + #[deprecated] attribute above every generated
// `anchor_lang::Owner` impl's `fn owner()`. The body (the constant program ID)
// is left intact, and the indentation of the existing `fn owner()` line is
// captured so the injected lines line up with whatever codama renders.
const ownerImplRe =
  /(impl anchor_lang::Owner for \w+ \{)(\s*)(fn owner\(\) -> Pubkey \{\s*crate::\w+_ID\s*\}\s*\})/g;

const ownerImplAnnotations = [
  "/// Returns the mutable Whirlpool program ID.",
  "///",
  "/// Using this with an account owned by the immutable Whirlpool program will",
  "/// cause anchor's owner check to reject a valid account. Prefer fetching",
  "/// the account via RPC and reading its `owner` field directly.",
  '#[deprecated(note = "returns mutable Whirlpool program ID only")]',
];

const patched = mapRenderMapContent(renderMap, (content) =>
  content.replace(ownerImplRe, (_, head, ws, body) => {
    const injected = ownerImplAnnotations.map((line) => ws + line).join("");
    return head + injected + ws + body;
  }),
);

const outDir = "./src/generated";
deleteDirectory(outDir);
writeRenderMap(patched, outDir);
