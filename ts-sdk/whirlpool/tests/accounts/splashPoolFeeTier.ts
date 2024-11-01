import { getFeeTierAddress, getFeeTierEncoder, WHIRLPOOL_PROGRAM_ADDRESS } from "@orca-so/whirlpools-client"
import { SPLASH_POOL_TICK_SPACING, WHIRLPOOLS_CONFIG_ADDRESS } from "../../src/config"

const feeTier = await getFeeTierAddress(WHIRLPOOLS_CONFIG_ADDRESS, SPLASH_POOL_TICK_SPACING);

export default {
  address: feeTier[0],
  data: getFeeTierEncoder().encode({
    whirlpoolsConfig: WHIRLPOOLS_CONFIG_ADDRESS,
    tickSpacing: SPLASH_POOL_TICK_SPACING,
    defaultFeeRate: 10000,
  }),
  owner: WHIRLPOOL_PROGRAM_ADDRESS,
};
