import { createFromRoot } from "codama";
import { renderVisitor } from "@codama/renderers-rust";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { readFileSync } from "fs";

const idl = JSON.parse(readFileSync("../../target/idl/whirlpool.json", "utf8"));
// IDL generated with anchor 0.29 does not have the metadata field so we have to add it manually
const node = rootNodeFromAnchor({
  ...idl,
  metadata: {
    address: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    origin: "anchor"
  }
});
const visitor = renderVisitor("./src/generated");
const codama = createFromRoot(node);
codama.accept(visitor);
