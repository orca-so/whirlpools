import { Program } from "@coral-xyz/anchor";
import { Instruction } from "@orca-so/common-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { Whirlpool } from "../artifacts/whirlpool";

/**
 * Parameters to collect rewards from a reward index in a position.
 *
 * @category Instruction Types
 * @param whirlpool - PublicKey for the whirlpool that the position will be opened for.
 * @param position - PublicKey for the  position will be opened for.
 * @param positionTokenAccount - PublicKey for the position token's associated token address.
 * @param rewardIndex - The reward index that we'd like to initialize. (0 <= index <= NUM_REWARDS).
 * @param rewardOwnerAccount - PublicKey for the reward token account that the reward will deposit into.
 * @param rewardVault - PublicKey of the vault account that reward will be withdrawn from.
 * @param positionAuthority - authority that owns the token corresponding to this desired position.
 */
export type CollectRewardParams = {
  whirlpool: PublicKey;
  position: PublicKey;
  positionTokenAccount: PublicKey;
  rewardIndex: number;
  rewardOwnerAccount: PublicKey;
  rewardVault: PublicKey;
  positionAuthority: PublicKey;
};

/**
 * Collect rewards accrued for this reward index in a position.
 * Call updateFeesAndRewards before this to update the position to the newest accrued values.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - CollectRewardParams object
 * @returns - Instruction to perform the action.
 */
export function collectRewardIx(
  program: Program<Whirlpool>,
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

  const ix = program.instruction.collectReward(rewardIndex, {
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
