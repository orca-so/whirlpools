import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to set the initialize pool authority in an AdaptiveFeeTier
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig this adaptive fee-tier is initialized in
 * @param feeAuthority - The feeAuthority in the WhirlpoolsConfig
 * @param adaptiveFeeTier - The adaptive fee-tier account that we would like to update
 * @param newInitializePoolAuthority - The new initialize pool authority in the AdaptiveFeeTier
 */
export type SetInitializePoolAuthorityParams = {
  whirlpoolsConfig: PublicKey;
  feeAuthority: PublicKey;
  adaptiveFeeTier: PublicKey;
  newInitializePoolAuthority: PublicKey;
};

/**
 * Sets the initialize pool authority for an AdaptiveFeeTier.
 * Only the fee authority has permission to invoke this instruction.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetInitializePoolAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setInitializePoolAuthorityIx(
  program: Program<Whirlpool>,
  params: SetInitializePoolAuthorityParams,
): Instruction {
  const {
    whirlpoolsConfig,
    feeAuthority,
    adaptiveFeeTier,
    newInitializePoolAuthority,
  } = params;

  const ix = program.instruction.setInitializePoolAuthority({
    accounts: {
      whirlpoolsConfig,
      feeAuthority,
      adaptiveFeeTier,
      newInitializePoolAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
