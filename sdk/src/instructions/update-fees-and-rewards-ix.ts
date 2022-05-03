import { UpdateFeesAndRewardsParams } from "..";
import { WhirlpoolContext } from "../context";
import { Instruction } from "../utils/transactions/transactions-builder";

export function buildUpdateFeesAndRewardsIx(
  context: WhirlpoolContext,
  params: UpdateFeesAndRewardsParams
): Instruction {
  const { whirlpool, position, tickArrayLower, tickArrayUpper } = params;

  const ix = context.program.instruction.updateFeesAndRewards({
    accounts: {
      whirlpool,
      position,
      tickArrayLower,
      tickArrayUpper,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
