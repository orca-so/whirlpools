import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Whirlpool } from "../artifacts/whirlpool";

import { Instruction } from "@orca-so/common-sdk";

/**
 * Parameters to initialize a rewards for a Whirlpool
 *
 * @category Instruction Types
 * @param whirlpool - PublicKey for the whirlpool config space that the fee-tier will be initialized for.
 * @param rewardIndex - The reward index that we'd like to initialize. (0 <= index <= NUM_REWARDS).
 * @param rewardMint - PublicKey for the reward mint that we'd use for the reward index.
 * @param rewardVaultKeypair - Keypair of the vault for this reward index.
 * @param rewardAuthority - Assigned authority by the reward_super_authority for the specified reward-index in this Whirlpool
 * @param funder - The account that would fund the creation of this account
 */
export type InitializeRewardParams = {
  whirlpool: PublicKey;
  rewardIndex: number;
  rewardMint: PublicKey;
  rewardVaultKeypair: Keypair;
  rewardAuthority: PublicKey;
  funder: PublicKey;
};

/**
 * Initialize reward for a Whirlpool. A pool can only support up to a set number of rewards.
 * The initial emissionsPerSecond is set to 0.
 *
 * #### Special Errors
 * - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized index in this pool,
 *                          or exceeds NUM_REWARDS, or all reward slots for this pool has been initialized.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - InitializeRewardParams object
 * @returns - Instruction to perform the action.
 */
export function initializeRewardIx(
  program: Program<Whirlpool>,
  params: InitializeRewardParams
): Instruction {
  const { rewardAuthority, funder, whirlpool, rewardMint, rewardVaultKeypair, rewardIndex } =
    params;

  const ix = program.instruction.initializeReward(rewardIndex, {
    accounts: {
      rewardAuthority,
      funder,
      whirlpool,
      rewardMint,
      rewardVault: rewardVaultKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [rewardVaultKeypair],
  };
}
