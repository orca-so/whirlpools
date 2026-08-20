import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import type { Instruction, PDA } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to initialize a PreparedSwap account.
 *
 * @category Instruction Types
 * @param preparedSwapPda - PDA for the PreparedSwap account that will be initialized
 * @param nonce - Nonce used to derive a unique PreparedSwap PDA. Must be less than or equal to MAX_PREPARED_SWAP_NONCE
 * @param funder - The account that would fund the creation of this account
 */
export type InitializePreparedSwapParams = {
  preparedSwapPda: PDA;
  nonce: number;
  funder: PublicKey;
};

/**
 * Initializes a PreparedSwap account.
 *
 * #### Special Errors
 *  `PreparedSwapNonceMaxExceeded` - if the provided nonce exceeds MAX_PREPARED_SWAP_NONCE.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - InitializePreparedSwapParams object
 * @returns - Instruction to perform the action.
 */
export function initializePreparedSwapIx(
  program: Program<Whirlpool>,
  params: InitializePreparedSwapParams,
): Instruction {
  const { preparedSwapPda, funder } = params;

  const ix = program.instruction.initializePreparedSwap(params.nonce, {
    accounts: {
      funder,
      preparedSwap: preparedSwapPda.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
