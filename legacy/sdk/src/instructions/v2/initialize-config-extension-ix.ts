import type { Program } from "@coral-xyz/anchor";
import type { Instruction, PDA } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to initialize a WhirlpoolsConfigExtension account.
 *
 * @category Instruction Types
 * @
 */
export type InitConfigExtensionParams = {
  whirlpoolsConfig: PublicKey;
  whirlpoolsConfigExtensionPda: PDA;
  funder: PublicKey;
  feeAuthority: PublicKey;
};

/**
 * Initializes a WhirlpoolsConfigExtension account that hosts info & authorities
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - InitConfigExtensionParams object
 * @returns - Instruction to perform the action.
 */
export function initializeConfigExtensionIx(
  program: Program<Whirlpool>,
  params: InitConfigExtensionParams,
): Instruction {
  const {
    whirlpoolsConfig,
    whirlpoolsConfigExtensionPda,
    funder,
    feeAuthority,
  } = params;

  const ix = program.instruction.initializeConfigExtension({
    accounts: {
      config: whirlpoolsConfig,
      configExtension: whirlpoolsConfigExtensionPda.publicKey,
      funder,
      feeAuthority,
      systemProgram: SystemProgram.programId,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
