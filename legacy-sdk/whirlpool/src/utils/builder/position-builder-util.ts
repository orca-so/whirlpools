import type { WhirlpoolContext } from "../..";
import type { WhirlpoolAccountFetchOptions } from "../../network/public/fetcher";
import type { PositionData, WhirlpoolData } from "../../types/public";
import { PDAUtil } from "../public";

export async function getTickArrayDataForPosition(
  ctx: WhirlpoolContext,
  position: PositionData,
  whirlpool: WhirlpoolData,
  opts?: WhirlpoolAccountFetchOptions,
) {
  const lowerTickArrayKey = PDAUtil.getTickArrayFromTickIndex(
    position.tickLowerIndex,
    whirlpool.tickSpacing,
    position.whirlpool,
    ctx.program.programId,
  ).publicKey;
  const upperTickArrayKey = PDAUtil.getTickArrayFromTickIndex(
    position.tickUpperIndex,
    whirlpool.tickSpacing,
    position.whirlpool,
    ctx.program.programId,
  ).publicKey;

  return await ctx.fetcher.getTickArrays(
    [lowerTickArrayKey, upperTickArrayKey],
    opts,
  );
}
