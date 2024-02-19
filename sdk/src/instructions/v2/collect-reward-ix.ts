import { Program } from "@coral-xyz/anchor";
import { Instruction } from "@orca-so/common-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { Whirlpool } from "../../artifacts/whirlpool";
import { MEMO_PROGRAM_ADDRESS } from "../..";

/**
 * Parameters to collect rewards from a reward index in a position.
 *
 * @category Instruction Types
 * @param whirlpool - PublicKey for the whirlpool that the position will be opened for.
 * @param position - PublicKey for the  position will be opened for.
 * @param positionTokenAccount - PublicKey for the position token's associated token address.
 * @param positionAuthority - authority that owns the token corresponding to this desired position.
 * @param rewardIndex - The reward index that we'd like to initialize. (0 <= index <= NUM_REWARDS).
 * @param rewardMint - PublicKey for the reward token mint.
 * @param rewardOwnerAccount - PublicKey for the reward token account that the reward will deposit into.
 * @param rewardVault - PublicKey of the vault account that reward will be withdrawn from.
 * @param tokenProgram - PublicKey for the token program.
 */
export type CollectRewardV2Params = {
  whirlpool: PublicKey;
  position: PublicKey;
  positionTokenAccount: PublicKey;
  positionAuthority: PublicKey;
  rewardIndex: number;
  rewardMint: PublicKey;
  rewardOwnerAccount: PublicKey;
  rewardVault: PublicKey;
  tokenProgram: PublicKey;
};

/**
 * Collect rewards accrued for this reward index in a position.
 * Call updateFeesAndRewards before this to update the position to the newest accrued values.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - CollectRewardV2Params object
 * @returns - Instruction to perform the action.
 */
export function collectRewardV2Ix(
  program: Program<Whirlpool>,
  params: CollectRewardV2Params
): Instruction {
  const {
    whirlpool,
    positionAuthority,
    position,
    positionTokenAccount,
    rewardMint,
    rewardOwnerAccount,
    rewardVault,
    rewardIndex,
    tokenProgram,
  } = params;

  const ix = program.instruction.collectRewardV2(rewardIndex, {
    accounts: {
      whirlpool,
      positionAuthority,
      position,
      positionTokenAccount,
      rewardMint,
      rewardOwnerAccount,
      rewardVault,
      tokenProgram,
      memoProgram: MEMO_PROGRAM_ADDRESS,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
