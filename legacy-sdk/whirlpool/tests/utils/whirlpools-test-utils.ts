import BN from "bn.js";
import type { WhirlpoolContext, WhirlpoolData } from "../../src";
import { getTokenBalance } from "./token";

export type VaultAmounts = {
  tokenA: BN;
  tokenB: BN;
};

export async function getVaultAmounts(
  ctx: WhirlpoolContext,
  whirlpoolData: WhirlpoolData,
) {
  return {
    tokenA: new BN(
      await getTokenBalance(ctx.provider, whirlpoolData.tokenVaultA),
    ),
    tokenB: new BN(
      await getTokenBalance(ctx.provider, whirlpoolData.tokenVaultB),
    ),
  };
}
