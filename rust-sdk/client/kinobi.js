import { createFromRoot } from "kinobi";
import { renderVisitor } from "@kinobi-so/renderers-rust";
import { rootNodeFromAnchor } from "@kinobi-so/nodes-from-anchor";
import idl from "../../target/idl/whirlpool.json" with { type: "json" };


const node = rootNodeFromAnchor(idl);
const visitor = renderVisitor("./src/generated");
// IDL generated with anchor 0.29 does not have the address field so we have to add it manually
const kinobi = createFromRoot({
  ...node,
  program: {
    ...node.program,
    publicKey: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
  }
});
kinobi.accept(visitor);
