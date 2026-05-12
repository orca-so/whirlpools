import { WhirlpoolDeployment } from "@orca-so/whirlpools";
import { _POSITION_BUNDLE_SIZE } from "@orca-so/whirlpools-core";
import { WHIRLPOOL_PROGRAM_ADDRESS } from "@orca-so/whirlpools-client";

console.info(
  WhirlpoolDeployment.mainnet.configAddress,
  _POSITION_BUNDLE_SIZE(),
  WHIRLPOOL_PROGRAM_ADDRESS,
);
