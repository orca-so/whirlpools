import { AccountFetchOpts } from "@orca-so/common-sdk";
import { WhirlpoolContext } from "../..";
import { PositionData, WhirlpoolData } from "../../types/public";
import { PDAUtil } from "../public";

export async function getTickArrayDataForPosition(
  ctx: WhirlpoolContext,
  position: PositionData,
  whirlpool: WhirlpoolData,
  opts?: AccountFetchOpts
) {
  const lowerTickArrayKey = PDAUtil.getTickArrayFromTickIndex(
    position.tickLowerIndex,
    whirlpool.tickSpacing,
    position.whirlpool,
    ctx.program.programId
  ).publicKey;
  const upperTickArrayKey = PDAUtil.getTickArrayFromTickIndex(
    position.tickUpperIndex,
    whirlpool.tickSpacing,
    position.whirlpool,
    ctx.program.programId
  ).publicKey;

  return await ctx.cache.getTickArrays([lowerTickArrayKey, upperTickArrayKey], opts);
}
