import { SetFeeAuthorityParams } from "..";
import { WhirlpoolContext } from "../context";
import { Instruction } from "../utils/transactions/transactions-builder";

export function buildSetFeeAuthorityIx(
  context: WhirlpoolContext,
  params: SetFeeAuthorityParams
): Instruction {
  const { whirlpoolsConfig, feeAuthority, newFeeAuthority } = params;

  const ix = context.program.instruction.setFeeAuthority({
    accounts: {
      whirlpoolsConfig,
      feeAuthority,
      newFeeAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
