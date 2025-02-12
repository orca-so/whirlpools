import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import type { Instruction, PDA } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../artifacts/whirlpool";

// TODO: comment
export type InitializeAdaptiveFeeConfigParams = {
  whirlpoolsConfig: PublicKey;
  feeTier: PublicKey;
  adaptiveFeeConfigPda: PDA;
  funder: PublicKey;
  feeAuthority: PublicKey;
  defaultFilterPeriod: number;
  defaultDecayPeriod: number;
  defaultReductionFactor: number;
  defaultAdaptiveFeeControlFactor: number;
  defaultMaxVolatilityAccumulator: number;
  defaultTickGroupSize: number;
};

// TODO: comment
export function initializeAdaptiveFeeConfigIx(
  program: Program<Whirlpool>,
  params: InitializeAdaptiveFeeConfigParams,
): Instruction {
  const ix = program.instruction.initializeAdaptiveFeeConfig(
    params.defaultFilterPeriod,
    params.defaultDecayPeriod,
    params.defaultReductionFactor,
    params.defaultAdaptiveFeeControlFactor,
    params.defaultMaxVolatilityAccumulator,
    params.defaultTickGroupSize,
    {
    accounts: {
      whirlpoolsConfig: params.whirlpoolsConfig,
      feeTier: params.feeTier,
      adaptiveFeeConfig: params.adaptiveFeeConfigPda.publicKey,
      funder: params.funder,
      feeAuthority: params.feeAuthority,
      systemProgram: anchor.web3.SystemProgram.programId,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
