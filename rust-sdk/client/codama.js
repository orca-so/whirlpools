import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-rust";
import { createFromRoot, updateAccountsVisitor } from "codama";
import { readFileSync } from "fs";

const idl = JSON.parse(readFileSync("../../target/idl/whirlpool.json", "utf8"));
const node = rootNodeFromAnchor(idl);
const visitor = renderVisitor("./src/generated");
const codama = createFromRoot(node);
codama.update(
  updateAccountsVisitor({
    TickArray: {
      name: "FixedTickArray",
    },
  }),
);
codama.accept(visitor);
