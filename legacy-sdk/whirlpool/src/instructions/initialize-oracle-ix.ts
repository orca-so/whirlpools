import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import type { Instruction, PDA } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../artifacts/whirlpool";

// TODO: comment
export type InitializeOracleParams = {
  whirlpool: PublicKey;
  oraclePda: PDA;
  funder: PublicKey;
};

// TODO: comment
export function initializeOracleIx(
  program: Program<Whirlpool>,
  params: InitializeOracleParams,
): Instruction {
  const { whirlpool, funder, oraclePda } = params;

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
