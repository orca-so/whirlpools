import { WhirlpoolContext } from "../context";
import { Instruction } from "../utils/transactions/transactions-builder";
import { SetRewardEmissionsSuperAuthorityParams } from "..";

export function buildSetRewardEmissionsSuperAuthorityIx(
  context: WhirlpoolContext,
  params: SetRewardEmissionsSuperAuthorityParams
): Instruction {
  const { whirlpoolsConfig, rewardEmissionsSuperAuthority, newRewardEmissionsSuperAuthority } =
    params;

  const ix = context.program.instruction.setRewardEmissionsSuperAuthority({
    accounts: {
      whirlpoolsConfig,
      rewardEmissionsSuperAuthority: rewardEmissionsSuperAuthority,
      newRewardEmissionsSuperAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
