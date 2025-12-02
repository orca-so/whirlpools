import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import type { Keypair, PublicKey } from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";

import type { Instruction } from "@orca-so/common-sdk";

type InitializeRewardV2BaseParams = {
  whirlpool: PublicKey;
  rewardIndex: number;
  rewardMint: PublicKey;
  rewardTokenBadge: PublicKey;
  rewardAuthority: PublicKey;
  funder: PublicKey;
  rewardTokenProgram: PublicKey;
};

/**
 * Parameters to initialize a rewards for a Whirlpool
 *
 * @category Instruction Types
 * @param whirlpool - PublicKey for the whirlpool config space that the fee-tier will be initialized for.
 * @param rewardIndex - The reward index that we'd like to initialize. (0 <= index <= NUM_REWARDS).
 * @param rewardMint - PublicKey for the reward mint that we'd use for the reward index.
 * @param rewardTokenBadge - PublicKey for the TokenBadge for this reward mint.
 * @param rewardVaultKeypair - Keypair of the vault for this reward index.
 * @param rewardAuthority - Assigned authority by the reward_super_authority for the specified reward-index in this Whirlpool
 * @param funder - The account that would fund the creation of this account
 * @param rewardTokenProgram - PublicKey for the token program.
 */
export type InitializeRewardV2Params = InitializeRewardV2BaseParams & {
  rewardVaultKeypair: Keypair;
};

/**
 * Parameters to initialize a rewards for a Whirlpool when the reward vault
 * account already exists and signing is handled externally (e.g. Squads,
 * other multisig, or an external signer).
 *
 * In this flow, the SDK does not include the reward vault keypair in the
 * returned signers.
 *
 * @category Instruction Types
 * @param whirlpool - PublicKey for the whirlpool config space that the fee-tier will be initialized for.
 * @param rewardIndex - The reward index that we'd like to initialize. (0 <= index <= NUM_REWARDS).
 * @param rewardMint - PublicKey for the reward mint that we'd use for the reward index.
 * @param rewardTokenBadge - PublicKey for the TokenBadge for this reward mint.
 * @param rewardVault - PublicKey of the existing vault for this reward index.
 * @param rewardAuthority - Assigned authority by the reward_super_authority for the specified reward-index in this Whirlpool
 * @param funder - The account that would fund the creation of this account
 * @param rewardTokenProgram - PublicKey for the token program.
 */
export type InitializeRewardV2WithExternalSignerParams =
  InitializeRewardV2BaseParams & {
    rewardVault: PublicKey;
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
 * @param params - InitializeRewardV2Params object
 * @returns - Instruction to perform the action.
 */
export function initializeRewardV2Ix(
  program: Program<Whirlpool>,
  params: InitializeRewardV2Params,
): Instruction {
  const {
    rewardAuthority,
    funder,
    whirlpool,
    rewardMint,
    rewardTokenBadge,
    rewardVaultKeypair,
    rewardIndex,
    rewardTokenProgram,
  } = params;

  const ix = program.instruction.initializeRewardV2(rewardIndex, {
    accounts: {
      rewardAuthority,
      funder,
      whirlpool,
      rewardMint,
      rewardTokenBadge,
      rewardVault: rewardVaultKeypair.publicKey,
      rewardTokenProgram,
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

/**
 * Initialize reward for a Whirlpool using an existing reward vault account
 * whose signing will be handled externally (e.g. via a multisig such as
 * Squads).
 *
 * This builds the same on-chain `initializeRewardV2` instruction but does
 * not include the reward vault keypair in the returned signers.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - InitializeRewardV2WithExternalSignerParams object
 * @returns - Instruction to perform the action.
 */
export function initializeRewardV2WithExternalSignerIx(
  program: Program<Whirlpool>,
  params: InitializeRewardV2WithExternalSignerParams,
): Instruction {
  const {
    rewardAuthority,
    funder,
    whirlpool,
    rewardMint,
    rewardTokenBadge,
    rewardVault,
    rewardIndex,
    rewardTokenProgram,
  } = params;

  const ix = program.instruction.initializeRewardV2(rewardIndex, {
    accounts: {
      rewardAuthority,
      funder,
      whirlpool,
      rewardMint,
      rewardTokenBadge,
      rewardVault,
      rewardTokenProgram,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
