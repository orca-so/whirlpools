import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../artifacts/whirlpool";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

/**
 * Parameters to transfer a position.
 *
 * @category Instruction Types
 * @param receiver - PublicKey for the wallet that will receive the rented lamports.
 * @param position - PublicKey for the position.
 * @param positionMint - PublicKey for the mint token for the Position token.
 * @param positionTokenAccount - The associated token address for the position token in the owners wallet.
 * @param destinationTokenAccount - The associated token address for the position token in the destination wallet.
 * @param positionAuthority - The authority that owns the position.
 * @param lockConfig - PublicKey for the lock config for the locked position.
 */
export type TransferLockedPositionParams = {
  receiver: PublicKey;
  position: PublicKey;
  positionMint: PublicKey;
  positionTokenAccount: PublicKey;
  destinationTokenAccount: PublicKey;
  positionAuthority: PublicKey;
  lockConfig: PublicKey;
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
      receiver: params.receiver,
      positionAuthority: params.positionAuthority,
      position: params.position,
      positionMint: params.positionMint,
      positionTokenAccount: params.positionTokenAccount,
      destinationTokenAccount: params.destinationTokenAccount,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      lockConfig: params.lockConfig,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
