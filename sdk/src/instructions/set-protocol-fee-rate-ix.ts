import { SetProtocolFeeRateParams } from "..";
import { WhirlpoolContext } from "../context";
import { Instruction } from "../utils/transactions/transactions-builder";

export function buildSetProtocolFeeRateIx(
  context: WhirlpoolContext,
  params: SetProtocolFeeRateParams
): Instruction {
  const { whirlpoolsConfig, whirlpool, feeAuthority, protocolFeeRate } = params;

  const ix = context.program.instruction.setProtocolFeeRate(protocolFeeRate, {
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
