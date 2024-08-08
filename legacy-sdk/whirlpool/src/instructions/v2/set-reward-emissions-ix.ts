import type { BN, Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to set rewards emissions for a reward in a Whirlpool
 *
 * @category Instruction Types
 * @param whirlpool - PublicKey for the whirlpool which the reward resides in.
 * @param rewardIndex - The reward index that we'd like to initialize. (0 <= index <= NUM_REWARDS).
 * @param rewardVaultKey - PublicKey of the vault for this reward index.
 * @param rewardAuthority - Assigned authority by the reward_super_authority for the specified reward-index in this Whirlpool
 * @param emissionsPerSecondX64 - The new emissions per second to set for this reward.
 */
export type SetRewardEmissionsV2Params = {
  whirlpool: PublicKey;
  rewardIndex: number;
  rewardVaultKey: PublicKey;
  rewardAuthority: PublicKey;
  emissionsPerSecondX64: BN;
};

/**
 * Set the reward emissions for a reward in a Whirlpool.
 *
 * #### Special Errors
 * - `RewardVaultAmountInsufficient` - The amount of rewards in the reward vault cannot emit more than a day of desired emissions.
 * - `InvalidTimestamp` - Provided timestamp is not in order with the previous timestamp.
 * - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized index in this pool,
 *                          or exceeds NUM_REWARDS.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetRewardEmissionsV2Params object
 * @returns - Instruction to perform the action.
 */
export function setRewardEmissionsV2Ix(
  program: Program<Whirlpool>,
  params: SetRewardEmissionsV2Params,
): Instruction {
  const {
    rewardAuthority,
    whirlpool,
    rewardIndex,
    rewardVaultKey: rewardVault,
    emissionsPerSecondX64,
  } = params;

  const ix = program.instruction.setRewardEmissionsV2(
    rewardIndex,
    emissionsPerSecondX64,
    {
      accounts: {
        rewardAuthority,
        whirlpool,
        rewardVault,
      },
    },
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
