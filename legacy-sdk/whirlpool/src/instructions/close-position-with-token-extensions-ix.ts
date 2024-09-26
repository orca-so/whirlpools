import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../artifacts/whirlpool";

/**
 * Parameters to close a position (based on Token-2022) in a Whirlpool.
 *
 * @category Instruction Types
 * @param receiver - PublicKey for the wallet that will receive the rented lamports.
 * @param position - PublicKey for the position.
 * @param positionMint - PublicKey for the mint token for the Position token.
 * @param positionTokenAccount - The associated token address for the position token in the owners wallet.
 * @param positionAuthority - Authority that owns the position token.
 */
export type ClosePositionWithTokenExtensionsParams = {
  receiver: PublicKey;
  position: PublicKey;
  positionMint: PublicKey;
  positionTokenAccount: PublicKey;
  positionAuthority: PublicKey;
};

/**
 * Close a position in a Whirlpool. Burns the position token in the owner's wallet.
 * Mint and TokenAccount are based on Token-2022. And Mint accout will be also closed.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - ClosePositionWithTokenExtensionsParams object
 * @returns - Instruction to perform the action.
 */
export function closePositionWithTokenExtensionsIx(
  program: Program<Whirlpool>,
  params: ClosePositionWithTokenExtensionsParams,
): Instruction {
  const {
    positionAuthority,
    receiver: receiver,
    position: position,
    positionMint,
    positionTokenAccount,
  } = params;

  const ix = program.instruction.closePositionWithTokenExtensions({
    accounts: {
      positionAuthority,
      receiver,
      position,
      positionMint,
      positionTokenAccount,
      token2022Program: TOKEN_2022_PROGRAM_ID,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
