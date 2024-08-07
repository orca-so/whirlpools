const { createFromRoot } = require("kinobi");
const { renderVisitor } = require("@kinobi-so/renderers-js");
const { rootNodeFromAnchor } = require("@kinobi-so/nodes-from-anchor");

const node = rootNodeFromAnchor(
  require("../../target/idl/whirlpool.json"),
);

const kinobi = createFromRoot(node);

kinobi.accept(
  renderVisitor("./src/generated"),
);

