import { WhirlpoolContext } from "../context";
import { Instruction } from "../utils/transactions/transactions-builder";
import { InitTickArrayParams } from "..";
import * as anchor from "@project-serum/anchor";

export function buildInitTickArrayIx(
  context: WhirlpoolContext,
  params: InitTickArrayParams
): Instruction {
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

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
