import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ClosePositionParams } from "..";
import { WhirlpoolContext } from "../context";
import { Instruction } from "../utils/transactions/transactions-builder";

export function buildClosePositionIx(
  context: WhirlpoolContext,
  params: ClosePositionParams
): Instruction {
  const { positionAuthority, receiver, position, positionMint, positionTokenAccount } = params;

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

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
