import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Instruction, PDA } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { Whirlpool } from "../artifacts/whirlpool";

/**
 * Parameters to initialize a Oracle account.
 *
 * @category Instruction Types
 * @param whirlpool - PublicKey for the whirlpool that the initialized oracle will host observations for.
 * @param funder - The account that would fund the creation of oracle account
 * @param oraclePda - PDA for the oracle account that will be initialized
 */
export type InitializeOracleParams = {
  whirlpool: PublicKey;
  funder: PublicKey;
  oraclePda: PDA;
};

/**
 * Initializes a Oracle account.
 *
 * @category Instructions
 * @param program - program object containing services required to generate the instruction
 * @param params - InitializeOracleParams object
 * @returns - Instruction to perform the action.
 */
export function initializeOracleIx(
  program: Program<Whirlpool>,
  params: InitializeOracleParams
): Instruction {
  const {
    whirlpool,
    funder,
    oraclePda,
  } = params;

  const ix = program.instruction.initializeOracle({
    accounts: {
      whirlpool,
      funder,
      oracle: oraclePda.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
