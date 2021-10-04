import { WhirlpoolContext } from "../context";
import { Instruction } from "../utils/transactions/transactions-builder";
import { SetRewardAuthorityBySuperAuthorityParams } from "..";

export function buildSetRewardAuthorityBySuperAuthorityIx(
  context: WhirlpoolContext,
  params: SetRewardAuthorityBySuperAuthorityParams
): Instruction {
  const {
    whirlpoolsConfig,
    whirlpool,
    rewardEmissionsSuperAuthority,
    newRewardAuthority,
    rewardIndex,
  } = params;

  const ix = context.program.instruction.setRewardAuthorityBySuperAuthority(rewardIndex, {
    accounts: {
      whirlpoolsConfig,
      whirlpool,
      rewardEmissionsSuperAuthority,
      newRewardAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
