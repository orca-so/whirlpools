import { Program } from "@coral-xyz/anchor";
import { Instruction } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to set the token badge authority in a WhirlpoolsConfigExtension
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - PublicKey for the whirlpools config account
 * @param whirlpoolsConfigExtension - The public key for the WhirlpoolsConfigExtension
 * @param tokenBadgeAuthority - The current tokenBadgeAuthority in the WhirlpoolsConfigExtension
 * @param newTokenBadgeAuthority - The new tokenBadgeAuthority in the WhirlpoolsConfigExtension
 */
export type SetTokenBadgeAuthorityParams = {
  whirlpoolsConfig: PublicKey;
  whirlpoolsConfigExtension: PublicKey;
  tokenBadgeAuthority: PublicKey;
  newTokenBadgeAuthority: PublicKey;
};

/**
 * Sets the token badge authority for a WhirlpoolsConfigExtension.
 * The token badge authority can initialize TokenBadge.
 * Only the current token badge authority has permission to invoke this instruction.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetTokenBadgeAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setTokenBadgeAuthorityIx(
  program: Program<Whirlpool>,
  params: SetTokenBadgeAuthorityParams
): Instruction {
  const { whirlpoolsConfig, whirlpoolsConfigExtension, tokenBadgeAuthority, newTokenBadgeAuthority } = params;

  const ix = program.instruction.setTokenBadgeAuthority({
    accounts: {
      whirlpoolsConfig,
      whirlpoolsConfigExtension,
      tokenBadgeAuthority,
      newTokenBadgeAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
