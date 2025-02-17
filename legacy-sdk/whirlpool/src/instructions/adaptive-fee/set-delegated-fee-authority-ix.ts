import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to set the delegated fee authority in an AdaptiveFeeTier
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig this adaptive fee-tier is initialized in
 * @param feeAuthority - The feeAuthority in the WhirlpoolsConfig
 * @param adaptiveFeeTier - The adaptive fee-tier account that we would like to update
 * @param newDelegatedFeeAuthority - The new delegated fee authority in the AdaptiveFeeTier
 */
export type SetDelegatedFeeAuthorityParams = {
  whirlpoolsConfig: PublicKey;
  feeAuthority: PublicKey;
  adaptiveFeeTier: PublicKey;
  newDelegatedFeeAuthority: PublicKey;
};

/**
 * Sets the delegated fee authority for an AdaptiveFeeTier.
 * Only the fee authority has permission to invoke this instruction.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetDelegatedFeeAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setDelegatedFeeAuthorityIx(
  program: Program<Whirlpool>,
  params: SetDelegatedFeeAuthorityParams,
): Instruction {
  const { whirlpoolsConfig, feeAuthority, adaptiveFeeTier, newDelegatedFeeAuthority } = params;

  const ix = program.instruction.setDelegatedFeeAuthority({
    accounts: {
      whirlpoolsConfig,
      feeAuthority,
      adaptiveFeeTier,
      newDelegatedFeeAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
