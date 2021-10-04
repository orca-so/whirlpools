import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { DecreaseLiquidityParams } from "..";
import { WhirlpoolContext } from "../context";
import { Instruction } from "../utils/transactions/transactions-builder";

export function buildDecreaseLiquidityIx(
  context: WhirlpoolContext,
  params: DecreaseLiquidityParams
): Instruction {
  const {
    liquidityAmount,
    tokenMinA,
    tokenMinB,
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

  const ix = context.program.instruction.decreaseLiquidity(liquidityAmount, tokenMinA, tokenMinB, {
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
