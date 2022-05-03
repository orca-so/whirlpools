import { SetRewardEmissionsParams } from "..";
import { WhirlpoolContext } from "../context";
import { Instruction } from "../utils/transactions/transactions-builder";

export function buildSetRewardEmissionsIx(
  context: WhirlpoolContext,
  params: SetRewardEmissionsParams
): Instruction {
  const { rewardAuthority, whirlpool, rewardIndex, rewardVault, emissionsPerSecondX64 } = params;

  const ix = context.program.instruction.setRewardEmissions(rewardIndex, emissionsPerSecondX64, {
    accounts: {
      rewardAuthority,
      whirlpool,
      rewardVault,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
