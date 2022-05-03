import { SetFeeRateParams } from "..";
import { WhirlpoolContext } from "../context";
import { Instruction } from "../utils/transactions/transactions-builder";

export function buildSetFeeRateIx(
  context: WhirlpoolContext,
  params: SetFeeRateParams
): Instruction {
  const { whirlpoolsConfig, whirlpool, feeAuthority, feeRate } = params;

  const ix = context.program.instruction.setFeeRate(feeRate, {
    accounts: {
      whirlpoolsConfig,
      whirlpool,
      feeAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
