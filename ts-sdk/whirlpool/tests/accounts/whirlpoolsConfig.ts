import { getWhirlpoolsConfigEncoder, WHIRLPOOL_PROGRAM_ADDRESS } from "@orca-so/whirlpools-client";
import { WHIRLPOOLS_CONFIG_ADDRESS } from "../../src/config"
import { DEFAULT_ADDRESS } from "../../src/config";

export default {
  address: WHIRLPOOLS_CONFIG_ADDRESS,
  data: getWhirlpoolsConfigEncoder().encode({
    feeAuthority: DEFAULT_ADDRESS,
    collectProtocolFeesAuthority: DEFAULT_ADDRESS,
    rewardEmissionsSuperAuthority: DEFAULT_ADDRESS,
    defaultProtocolFeeRate: 100,
  }),
  owner: WHIRLPOOL_PROGRAM_ADDRESS,
};
