import { WhirlpoolContext } from "../context";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Instruction } from "../utils/transactions/transactions-builder";
import { CollectRewardParams } from "..";

export function buildCollectRewardIx(
  context: WhirlpoolContext,
  params: CollectRewardParams
): Instruction {
  const {
    whirlpool,
    positionAuthority,
    position,
    positionTokenAccount,
    rewardOwnerAccount,
    rewardVault,
    rewardIndex,
  } = params;

  const ix = context.program.instruction.collectReward(rewardIndex, {
    accounts: {
      whirlpool,
      positionAuthority,
      position,
      positionTokenAccount,
      rewardOwnerAccount,
      rewardVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
