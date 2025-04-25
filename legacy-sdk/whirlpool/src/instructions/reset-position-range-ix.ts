import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import { SystemProgram, type PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../artifacts/whirlpool";

/**
 * Parameters to reset a position's range. Requires liquidity to be zero.
 *
 * @category Instruction Types
 * @param whirlpool - PublicKey for the whirlpool that the position will be opened for.
 * @param positionTokenAccount - The associated token address for the position token in the owners wallet.
 * @param tickLowerIndex - The tick specifying the lower end of the position range.
 * @param tickUpperIndex - The tick specifying the upper end of the position range.
 * @param funder - The account that would fund the creation of this account
 */
export type ResetPositionRangeParams = {
  funder: PublicKey;
  positionAuthority: PublicKey;
  whirlpool: PublicKey;
  position: PublicKey;
  positionTokenAccount: PublicKey;
  tickLowerIndex: number;
  tickUpperIndex: number;
};

/**
 * Reset a position's range. Requires liquidity to be zero.
 *
 * #### Special Errors
 * `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of the tick-spacing in this pool.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - ResetPositionRangeParams object
 * @returns - Instruction to perform the action.
 */
export function resetPositionRangeIx(
  program: Program<Whirlpool>,
  params: ResetPositionRangeParams,
): Instruction {
  const {
    funder,
    positionAuthority,
    whirlpool,
    position,
    positionTokenAccount,
    tickLowerIndex,
    tickUpperIndex,
  } = params;

  const ix = program.instruction.resetPositionRange(
    tickLowerIndex,
    tickUpperIndex,
    {
      accounts: {
        funder,
        positionAuthority,
        whirlpool,
        position,
        positionTokenAccount,
        systemProgram: SystemProgram.programId,
      },
    },
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
