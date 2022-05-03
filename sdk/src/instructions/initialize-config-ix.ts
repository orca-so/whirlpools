import { SystemProgram } from "@solana/web3.js";
import { WhirlpoolContext } from "../context";
import { InitConfigParams } from "../types/public/ix-types";
import { Instruction } from "../utils/transactions/transactions-builder";

export function buildInitializeConfigIx(
  context: WhirlpoolContext,
  params: InitConfigParams
): Instruction {
  const {
    feeAuthority,
    collectProtocolFeesAuthority,
    rewardEmissionsSuperAuthority,
    defaultProtocolFeeRate,
    funder,
  } = params;

  const ix = context.program.instruction.initializeConfig(
    feeAuthority,
    collectProtocolFeesAuthority,
    rewardEmissionsSuperAuthority,
    defaultProtocolFeeRate,
    {
      accounts: {
        config: params.whirlpoolConfigKeypair.publicKey,
        funder,
        systemProgram: SystemProgram.programId,
      },
    }
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [params.whirlpoolConfigKeypair],
  };
}
