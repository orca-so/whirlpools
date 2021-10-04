import { getFeeTierPda, SetDefaultFeeRateParams } from "..";
import { WhirlpoolContext } from "../context";
import { Instruction } from "../utils/transactions/transactions-builder";

export function buildSetDefaultFeeRateIx(
  context: WhirlpoolContext,
  params: SetDefaultFeeRateParams
): Instruction {
  const { whirlpoolsConfig, feeAuthority, tickSpacing, defaultFeeRate } = params;

  const feeTierPda = getFeeTierPda(context.program.programId, whirlpoolsConfig, tickSpacing);

  const ix = context.program.instruction.setDefaultFeeRate(defaultFeeRate, {
    accounts: {
      whirlpoolsConfig,
      feeTier: feeTierPda.publicKey,
      feeAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
