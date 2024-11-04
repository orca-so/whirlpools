import { createFromRoot } from "codama";
import { renderVisitor } from "@codama/renderers-ts";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { readFileSync } from "fs";

const idl = JSON.parse(readFileSync("../../target/idl/whirlpool.json", "utf8"));
const node = rootNodeFromAnchor(idl);
const visitor = renderVisitor("./src/generated");
// IDL generated with anchor 0.29 does not have the address field so we have to add it manually
const codama = createFromRoot({
  ...node,
  program: {
    ...node.program,
    publicKey: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  },
});
codama.accept(visitor);
