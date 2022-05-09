import { Program } from "@project-serum/anchor";
import { Whirlpool } from "../artifacts/whirlpool";
import { Instruction } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";

/**
 * Parameters to set the fee authority in a WhirlpoolsConfig
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig this pool is initialized in
 * @param feeAuthority - The current feeAuthority in the WhirlpoolsConfig
 * @param newFeeAuthority - The new feeAuthority in the WhirlpoolsConfig
 */
export type SetFeeAuthorityParams = {
  whirlpoolsConfig: PublicKey;
  feeAuthority: PublicKey;
  newFeeAuthority: PublicKey;
};

/**
 * Sets the fee authority for a WhirlpoolsConfig.
 * The fee authority can set the fee & protocol fee rate for individual pools or set the default fee rate for newly minted pools.
 * Only the current fee authority has permission to invoke this instruction.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetFeeAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setFeeAuthorityIx(
  program: Program<Whirlpool>,
  params: SetFeeAuthorityParams
): Instruction {
  const { whirlpoolsConfig, feeAuthority, newFeeAuthority } = params;

  const ix = program.instruction.setFeeAuthority({
    accounts: {
      whirlpoolsConfig,
      feeAuthority,
      newFeeAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
