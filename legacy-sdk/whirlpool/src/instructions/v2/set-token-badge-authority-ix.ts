import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to set the token badge authority in a WhirlpoolsConfigExtension
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - PublicKey for the whirlpools config account
 * @param whirlpoolsConfigExtension - The public key for the WhirlpoolsConfigExtension
 * @param configExtensionAuthority - The current configExtensionAuthority in the WhirlpoolsConfigExtension
 * @param newTokenBadgeAuthority - The new tokenBadgeAuthority in the WhirlpoolsConfigExtension
 */
export type SetTokenBadgeAuthorityParams = {
  whirlpoolsConfig: PublicKey;
  whirlpoolsConfigExtension: PublicKey;
  configExtensionAuthority: PublicKey;
  newTokenBadgeAuthority: PublicKey;
};

/**
 * Sets the token badge authority for a WhirlpoolsConfigExtension.
 * The token badge authority can initialize TokenBadge.
 * Only the config extension authority has permission to invoke this instruction.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetTokenBadgeAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setTokenBadgeAuthorityIx(
  program: Program<Whirlpool>,
  params: SetTokenBadgeAuthorityParams,
): Instruction {
  const {
    whirlpoolsConfig,
    whirlpoolsConfigExtension,
    configExtensionAuthority,
    newTokenBadgeAuthority,
  } = params;

  const ix = program.instruction.setTokenBadgeAuthority({
    accounts: {
      whirlpoolsConfig,
      whirlpoolsConfigExtension,
      configExtensionAuthority,
      newTokenBadgeAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
