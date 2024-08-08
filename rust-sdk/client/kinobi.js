import { createFromRoot } from "kinobi";
import { renderVisitor } from "@kinobi-so/renderers-rust";
import { rootNodeFromAnchor } from "@kinobi-so/nodes-from-anchor";
import idl from "../../target/idl/whirlpool.json" with { type: "json" };

const node = rootNodeFromAnchor(idl);
const visitor = renderVisitor("./src/generated");
const kinobi = createFromRoot(node);
kinobi.accept(visitor);
