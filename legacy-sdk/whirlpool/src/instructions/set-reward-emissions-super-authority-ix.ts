import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../artifacts/whirlpool";

/**
 * Parameters to set rewards emissions for a reward in a Whirlpool
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - PublicKey for the WhirlpoolsConfig that we want to update.
 * @param rewardEmissionsSuperAuthority - Current reward emission super authority in this WhirlpoolsConfig
 * @param newRewardEmissionsSuperAuthority - New reward emission super authority for this WhirlpoolsConfig
 */
export type SetRewardEmissionsSuperAuthorityParams = {
  whirlpoolsConfig: PublicKey;
  rewardEmissionsSuperAuthority: PublicKey;
  newRewardEmissionsSuperAuthority: PublicKey;
};

/**
 * Set the whirlpool reward super authority for a WhirlpoolsConfig
 * Only the current reward super authority has permission to invoke this instruction.
 * This instruction will not change the authority on any `WhirlpoolRewardInfo` whirlpool rewards.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetRewardEmissionsSuperAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setRewardEmissionsSuperAuthorityIx(
  program: Program<Whirlpool>,
  params: SetRewardEmissionsSuperAuthorityParams,
): Instruction {
  const {
    whirlpoolsConfig,
    rewardEmissionsSuperAuthority,
    newRewardEmissionsSuperAuthority,
  } = params;

  const ix = program.instruction.setRewardEmissionsSuperAuthority({
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
