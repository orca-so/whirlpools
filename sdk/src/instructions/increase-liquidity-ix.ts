import { WhirlpoolContext } from "../context";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Instruction } from "../utils/transactions/transactions-builder";
import { IncreaseLiquidityParams } from "..";

export function buildIncreaseLiquidityIx(
  context: WhirlpoolContext,
  params: IncreaseLiquidityParams
): Instruction {
  const {
    liquidityAmount,
    tokenMaxA,
    tokenMaxB,
    whirlpool,
    positionAuthority,
    position,
    positionTokenAccount,
    tokenOwnerAccountA,
    tokenOwnerAccountB,
    tokenVaultA,
    tokenVaultB,
    tickArrayLower,
    tickArrayUpper,
  } = params;

  const ix = context.program.instruction.increaseLiquidity(liquidityAmount, tokenMaxA, tokenMaxB, {
    accounts: {
      whirlpool,
      tokenProgram: TOKEN_PROGRAM_ID,
      positionAuthority,
      position,
      positionTokenAccount,
      tokenOwnerAccountA,
      tokenOwnerAccountB,
      tokenVaultA,
      tokenVaultB,
      tickArrayLower,
      tickArrayUpper,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
