import { DEFAULT_WHIRLPOOLS_CONFIG_ADDRESSES } from "@orca-so/whirlpools";
import { _POSITION_BUNDLE_SIZE } from "@orca-so/whirlpools-core";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "@orca-so/whirlpools-client";

console.info(
  DEFAULT_WHIRLPOOLS_CONFIG_ADDRESSES.solanaMainnet,
  _POSITION_BUNDLE_SIZE(),
  WHIRLPOOL_PROGRAM_ADDRESS,
);
