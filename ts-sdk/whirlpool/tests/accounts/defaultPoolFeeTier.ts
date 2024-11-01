import { getFeeTierAddress, getFeeTierEncoder, WHIRLPOOL_PROGRAM_ADDRESS } from "@orca-so/whirlpools-client";
import { WHIRLPOOLS_CONFIG_ADDRESS } from "../../src/config";

const tickSpacing = 128;
const feeTier = await getFeeTierAddress(WHIRLPOOLS_CONFIG_ADDRESS, tickSpacing);

export default {
  address: feeTier[0],
  data: getFeeTierEncoder().encode({
    whirlpoolsConfig: WHIRLPOOLS_CONFIG_ADDRESS,
    tickSpacing,
    defaultFeeRate: 10000,
  }),
  owner: WHIRLPOOL_PROGRAM_ADDRESS,
};
