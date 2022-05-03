import { WhirlpoolContext } from "../context";
import { SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { Instruction } from "../utils/transactions/transactions-builder";
import { InitPoolParams } from "..";
import { WhirlpoolBumpsData } from "../types/public/anchor-types";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export function buildInitPoolIx(context: WhirlpoolContext, params: InitPoolParams): Instruction {
  const program = context.program;

  const {
    initSqrtPrice,
    tokenMintA,
    tokenMintB,
    whirlpoolConfigKey,
    whirlpoolPda,
    feeTierKey,
    tokenVaultAKeypair,
    tokenVaultBKeypair,
    tickSpacing,
    funder,
  } = params;

  const whirlpoolBumps: WhirlpoolBumpsData = {
    whirlpoolBump: whirlpoolPda.bump,
  };

  const ix = program.instruction.initializePool(whirlpoolBumps, tickSpacing, initSqrtPrice, {
    accounts: {
      whirlpoolsConfig: whirlpoolConfigKey,
      tokenMintA: tokenMintA,
      tokenMintB: tokenMintB,
      funder,
      whirlpool: whirlpoolPda.publicKey,
      tokenVaultA: tokenVaultAKeypair.publicKey,
      tokenVaultB: tokenVaultBKeypair.publicKey,
      feeTier: feeTierKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [tokenVaultAKeypair, tokenVaultBKeypair],
  };
}
