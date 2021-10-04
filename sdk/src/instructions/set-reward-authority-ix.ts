import { WhirlpoolContext } from "../context";
import { Instruction } from "../utils/transactions/transactions-builder";
import { SetRewardAuthorityParams } from "..";

export function buildSetRewardAuthorityIx(
  context: WhirlpoolContext,
  params: SetRewardAuthorityParams
): Instruction {
  const { whirlpool, rewardAuthority, newRewardAuthority, rewardIndex } = params;
  const ix = context.program.instruction.setRewardAuthority(rewardIndex, {
    accounts: {
      whirlpool,
      rewardAuthority,
      newRewardAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
