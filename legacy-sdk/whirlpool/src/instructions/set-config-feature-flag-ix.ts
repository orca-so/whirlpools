import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../artifacts/whirlpool";
import type { ConfigFeatureFlagData } from "../types/public";

/**
 * Parameters to set the feature flag in a WhirlpoolsConfig
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig
 * @param authority - The public key of the authority that is allowed to set the feature flags
 * @param featureFlag - The feature flag to set in the WhirlpoolsConfig
 */
export type SetConfigFeatureFlagParams = {
  whirlpoolsConfig: PublicKey;
  authority: PublicKey;
  featureFlag: ConfigFeatureFlagData;
};

/**
 * Sets the feature flag for a WhirlpoolsConfig.
 *
 * @category Instructions
 * @param program - program object containing services required to generate the instruction
 * @param params - SetConfigFeatureFlagParams object
 * @returns - Instruction to perform the action.
 */
export function setConfigFeatureFlagIx(
  program: Program<Whirlpool>,
  params: SetConfigFeatureFlagParams,
): Instruction {
  const { whirlpoolsConfig, authority, featureFlag } = params;

  const ix = program.instruction.setConfigFeatureFlag(featureFlag, {
    accounts: {
      whirlpoolsConfig,
      authority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
