import type { BN, Program } from "@coral-xyz/anchor";
import type { Instruction, PDA } from "@orca-so/common-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Keypair, PublicKey } from "@solana/web3.js";
import { SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import type { Whirlpool } from "../artifacts/whirlpool";
import type { WhirlpoolBumpsData } from "../types/public/anchor-types";

/**
 * Parameters to initialize a Whirlpool account.
 *
 * @category Instruction Types
 * @param initSqrtPrice - The desired initial sqrt-price for this pool
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig this pool is initialized in
 * @param whirlpoolPda - PDA for the whirlpool account that would be initialized
 * @param tokenMintA - Mint public key for token A
 * @param tokenMintB - Mint public key for token B
 * @param tokenVaultAKeypair - Keypair of the token A vault for this pool
 * @param tokenVaultBKeypair - Keypair of the token B vault for this pool
 * @param feeTierKey - PublicKey of the fee-tier account that this pool would use for the fee-rate
 * @param tickSpacing - The desired tick spacing for this pool.
 * @param funder - The account that would fund the creation of this account
 */
export type InitPoolParams = {
  initSqrtPrice: BN;
  whirlpoolsConfig: PublicKey;
  whirlpoolPda: PDA;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  tokenVaultAKeypair: Keypair;
  tokenVaultBKeypair: Keypair;
  feeTierKey: PublicKey;
  tickSpacing: number;
  funder: PublicKey;
};

/**
 * Initializes a tick_array account to represent a tick-range in a Whirlpool.
 *
 * Special Errors
 * `InvalidTokenMintOrder` - The order of mints have to be ordered by
 * `SqrtPriceOutOfBounds` - provided initial_sqrt_price is not between 2^-64 to 2^64
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - InitPoolParams object
 * @returns - Instruction to perform the action.
 */
export function initializePoolIx(
  program: Program<Whirlpool>,
  params: InitPoolParams,
): Instruction {
  const {
    initSqrtPrice,
    tokenMintA,
    tokenMintB,
    whirlpoolsConfig,
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

  const ix = program.instruction.initializePool(
    whirlpoolBumps,
    tickSpacing,
    initSqrtPrice,
    {
      accounts: {
        whirlpoolsConfig,
        tokenMintA,
        tokenMintB,
        funder,
        whirlpool: whirlpoolPda.publicKey,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenVaultB: tokenVaultBKeypair.publicKey,
        feeTier: feeTierKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      },
    },
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [tokenVaultAKeypair, tokenVaultBKeypair],
  };
}
