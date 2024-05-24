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
 * @param configExtensionAuthority - The current configExtensionAuthority in the WhirlpoolsConfigExtension
 * @param newConfigExtensionAuthority - The new configExtensionAuthority in the WhirlpoolsConfigExtension
 */
export type SetConfigExtensionAuthorityParams = {
  whirlpoolsConfig: PublicKey;
  whirlpoolsConfigExtension: PublicKey;
  configExtensionAuthority: PublicKey;
  newConfigExtensionAuthority: PublicKey;
};

/**
 * Sets the config extension authority for a WhirlpoolsConfigExtension.
 * Only the current config extension authority has permission to invoke this instruction.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetTokenBadgeAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setConfigExtensionAuthorityIx(
  program: Program<Whirlpool>,
  params: SetConfigExtensionAuthorityParams
): Instruction {
  const { whirlpoolsConfig, whirlpoolsConfigExtension, configExtensionAuthority, newConfigExtensionAuthority } = params;

  const ix = program.instruction.setConfigExtensionAuthority({
    accounts: {
      whirlpoolsConfig,
      whirlpoolsConfigExtension,
      configExtensionAuthority,
      newConfigExtensionAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
