import { Program } from "@coral-xyz/anchor";
import { Instruction, PDA } from "@orca-so/common-sdk";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to initialize a WhirlpoolsConfigExtension account.
 *
 * @category Instruction Types
 * @
 */
export type InitConfigExtensionParams = {
  whirlpoolsConfig: PublicKey;
  whirlpoolsConfigExtenssionPda: PDA;
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
  params: InitConfigExtensionParams
): Instruction {
  const {
    whirlpoolsConfig,
    whirlpoolsConfigExtenssionPda,
    funder,
    feeAuthority,
  } = params;

  const ix = program.instruction.initializeConfigExtension(
    {
      accounts: {
        config: whirlpoolsConfig,
        configExtension: whirlpoolsConfigExtenssionPda.publicKey,
        funder,
        feeAuthority,
        systemProgram: SystemProgram.programId,
      },
    }
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
