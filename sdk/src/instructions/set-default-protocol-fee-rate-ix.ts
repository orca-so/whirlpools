import { SetDefaultProtocolFeeRateParams } from "..";
import { WhirlpoolContext } from "../context";
import { Instruction } from "../utils/transactions/transactions-builder";

export function buildSetDefaultProtocolFeeRateIx(
  context: WhirlpoolContext,
  params: SetDefaultProtocolFeeRateParams
): Instruction {
  const { whirlpoolsConfig, feeAuthority, defaultProtocolFeeRate } = params;

  const ix = context.program.instruction.setDefaultProtocolFeeRate(defaultProtocolFeeRate, {
    accounts: {
      whirlpoolsConfig,
      feeAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
