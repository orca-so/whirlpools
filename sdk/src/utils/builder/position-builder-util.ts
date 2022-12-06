import { WhirlpoolContext } from "../..";
import { PositionData, WhirlpoolData } from "../../types/public";
import { PDAUtil } from "../public";

export async function getTickArrayDataForPosition(
  ctx: WhirlpoolContext,
  position: PositionData,
  whirlpool: WhirlpoolData,
  refresh: boolean
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

  return await ctx.fetcher.listTickArrays([lowerTickArrayKey, upperTickArrayKey], refresh);
}
