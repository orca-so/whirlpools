import { WhirlpoolContext } from "../context";
import { TransformableInstruction } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import { PDA } from "@orca-so/common-sdk";
import { transformTx } from "../utils/instructions-util";

/**
 * Parameters to initialize a TickArray account.
 *
 * @category Instruction Types
 * @param whirlpool - PublicKey for the whirlpool that the initialized tick-array will host ticks for.
 * @param tickArrayPda - PDA for the tick array account that will be initialized
 * @param startTick - The starting tick index for this tick-array. Has to be a multiple of TickArray size & the tick spacing of this pool.
 * @param funder - The account that would fund the creation of this account
 */
export type InitTickArrayParams = {
  whirlpool: PublicKey;
  tickArrayPda: PDA;
  startTick: number;
  funder: PublicKey;
};

/**
 * Initializes a TickArray account.
 *
 * #### Special Errors
 *  `InvalidStartTick` - if the provided start tick is out of bounds or is not a multiple of TICK_ARRAY_SIZE * tick spacing.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - InitTickArrayParams object
 * @returns - Instruction to perform the action.
 */
export function initTickArrayIx(
  context: WhirlpoolContext,
  params: InitTickArrayParams
): TransformableInstruction {
  const program = context.program;

  const { whirlpool, funder, tickArrayPda } = params;

  const ix = program.instruction.initializeTickArray(params.startTick, {
    accounts: {
      whirlpool,
      funder,
      tickArray: tickArrayPda.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    },
  });

  return transformTx(context, {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  });
}
