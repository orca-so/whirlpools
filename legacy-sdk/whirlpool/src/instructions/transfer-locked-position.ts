import type { Program } from "@coral-xyz/anchor";
import type { Instruction, PDA } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../artifacts/whirlpool";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

/**
 * Parameters to transfer a position.
 *
 * @category Instruction Types
 * @param authority - The authority that owns the position.
 * @param positionPda - PDA for the position.
 * @param positionMint - PublicKey for the mint token for the Position token.
 * @param positionTokenAccount - The associated token address for the position token in the owners wallet.
 * @param destinationTokenAccount - The associated token address for the position token in the destination wallet.
 * @param positionTokenProgram - The program id for the position token program.
 */
export type TransferLockedPositionParams = {
  positionPda: PDA;
  positionMint: PublicKey;
  positionTokenAccount: PublicKey;
  destinationTokenAccount: PublicKey;
  authority: PublicKey;
  lockConfigPda: PDA;
};

/**
 * Transfer the position to to a different token account. This instruction also works for locked positions.
 *
 * @category Instructions
 * @param program - program object containing services required to generate the instruction
 * @param params - LockPositionParams object.
 * @returns - Instruction to perform the action.
 */
export function transferLockedPositionIx(
  program: Program<Whirlpool>,
  params: TransferLockedPositionParams,
): Instruction {
  const ix = program.instruction.transferLockedPosition({
    accounts: {
      positionAuthority: params.authority,
      position: params.positionPda.publicKey,
      positionMint: params.positionMint,
      positionTokenAccount: params.positionTokenAccount,
      destinationTokenAccount: params.destinationTokenAccount,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      lockConfig: params.lockConfigPda.publicKey,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
