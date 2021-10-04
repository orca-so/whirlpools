import { SetCollectProtocolFeesAuthorityParams } from "..";
import { WhirlpoolContext } from "../context";
import { Instruction } from "../utils/transactions/transactions-builder";

export function buildSetCollectProtocolFeesAuthorityIx(
  context: WhirlpoolContext,
  params: SetCollectProtocolFeesAuthorityParams
): Instruction {
  const { whirlpoolsConfig, collectProtocolFeesAuthority, newCollectProtocolFeesAuthority } =
    params;

  const ix = context.program.instruction.setCollectProtocolFeesAuthority({
    accounts: {
      whirlpoolsConfig,
      collectProtocolFeesAuthority,
      newCollectProtocolFeesAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
