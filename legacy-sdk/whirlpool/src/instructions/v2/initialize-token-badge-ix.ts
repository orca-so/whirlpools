import type { Program } from "@coral-xyz/anchor";
import type { Instruction, PDA } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to initialize a TokenBadge account.
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig
 * @param whirlpoolsConfigExtension - The public key for the WhirlpoolsConfigExtension
 * @param tokenBadgeAuthority - The public key for the tokenBadgeAuthority
 * @param tokenMint - The public key for the mint for which the TokenBadge is being initialized
 * @param tokenBadgePda - The PDA for the TokenBadge account
 * @param funder - The account that would fund the creation of this account
 */
export type InitializeTokenBadgeParams = {
  whirlpoolsConfig: PublicKey;
  whirlpoolsConfigExtension: PublicKey;
  tokenBadgeAuthority: PublicKey;
  tokenMint: PublicKey;
  tokenBadgePda: PDA;
  funder: PublicKey;
};

/**
 * Initializes a TokenBadge account.
 *
 * @category Instructions
 * @param program - program object containing services required to generate the instruction
 * @param params - InitializeTokenBadgeParams object
 * @returns - Instruction to perform the action.
 */
export function initializeTokenBadgeIx(
  program: Program<Whirlpool>,
  params: InitializeTokenBadgeParams,
): Instruction {
  const {
    whirlpoolsConfig,
    whirlpoolsConfigExtension,
    tokenBadgeAuthority,
    tokenMint,
    tokenBadgePda,
    funder,
  } = params;

  const ix = program.instruction.initializeTokenBadge({
    accounts: {
      whirlpoolsConfig,
      whirlpoolsConfigExtension,
      tokenBadgeAuthority,
      tokenMint,
      tokenBadge: tokenBadgePda.publicKey,
      funder,
      systemProgram: SystemProgram.programId,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
