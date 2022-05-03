import { WhirlpoolContext } from "../context";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Instruction } from "../utils/transactions/transactions-builder";
import { CollectProtocolFeesParams } from "..";

export function buildCollectProtocolFeesIx(
  context: WhirlpoolContext,
  params: CollectProtocolFeesParams
): Instruction {
  const {
    whirlpoolsConfig,
    whirlpool,
    collectProtocolFeesAuthority,
    tokenVaultA,
    tokenVaultB,
    tokenDestinationA,
    tokenDestinationB,
  } = params;

  const ix = context.program.instruction.collectProtocolFees({
    accounts: {
      whirlpoolsConfig,
      whirlpool,
      collectProtocolFeesAuthority,
      tokenVaultA,
      tokenVaultB,
      tokenDestinationA,
      tokenDestinationB,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
