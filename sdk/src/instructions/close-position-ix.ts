import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { WhirlpoolContext } from "../context";
import { TransformableInstruction } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { transformTx } from "../utils/instructions-util";

/**
 * Parameters to close a position in a Whirlpool.
 *
 * @category Instruction Types
 * @param receiver - PublicKey for the wallet that will receive the rented lamports.
 * @param position - PublicKey for the position.
 * @param positionMint - PublicKey for the mint token for the Position token.
 * @param positionTokenAccount - The associated token address for the position token in the owners wallet.
 * @param positionAuthority - Authority that owns the position token.
 */
export type ClosePositionParams = {
  receiver: PublicKey;
  position: PublicKey;
  positionMint: PublicKey;
  positionTokenAccount: PublicKey;
  positionAuthority: PublicKey;
};

/**
 * Close a position in a Whirlpool. Burns the position token in the owner's wallet.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - ClosePositionParams object
 * @returns - Instruction to perform the action.
 */
export function closePositionIx(
  context: WhirlpoolContext,
  params: ClosePositionParams
): TransformableInstruction {
  const {
    positionAuthority,
    receiver: receiver,
    position: position,
    positionMint: positionMint,
    positionTokenAccount,
  } = params;

  const ix = context.program.instruction.closePosition({
    accounts: {
      positionAuthority,
      receiver,
      position,
      positionMint,
      positionTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
  });

  return transformTx(context, {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  });
}
