import { SystemProgram } from "@solana/web3.js";
import { getFeeTierPda } from "..";
import { WhirlpoolContext } from "../context";
import { InitFeeTierParams } from "../types/public/ix-types";
import { Instruction } from "../utils/transactions/transactions-builder";

export function buildInitializeFeeTier(
  context: WhirlpoolContext,
  params: InitFeeTierParams
): Instruction {
  const { feeTierPda, whirlpoolConfigKey, tickSpacing, feeAuthority, defaultFeeRate, funder } =
    params;

  const ix = context.program.instruction.initializeFeeTier(tickSpacing, defaultFeeRate, {
    accounts: {
      config: whirlpoolConfigKey,
      feeTier: feeTierPda.publicKey,
      feeAuthority,
      funder,
      systemProgram: SystemProgram.programId,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
