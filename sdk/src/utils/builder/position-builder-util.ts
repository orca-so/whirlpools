import { WhirlpoolContext } from "../..";
import { PositionData, WhirlpoolData } from "../../types/public";
import { PDAUtil } from "../public";

export async function getTickArrayDataForPosition(
  ctx: WhirlpoolContext,
  position: PositionData,
  whirlpool: WhirlpoolData
) {
  const lowerTickArrayPda = PDAUtil.getTickArrayFromTickIndex(
    position.tickLowerIndex,
    whirlpool.tickSpacing,
    position.whirlpool,
    ctx.program.programId
  ).publicKey;
  const upperTickArrayPda = PDAUtil.getTickArrayFromTickIndex(
    position.tickUpperIndex,
    whirlpool.tickSpacing,
    position.whirlpool,
    ctx.program.programId
  ).publicKey;

  return await ctx.fetcher.listTickArrays([lowerTickArrayPda, upperTickArrayPda], true);
}
