import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import type { Instruction, PDA } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../artifacts/whirlpool";

// TODO: comment
export type InitializeAdaptiveFeeTierParams = {
  whirlpoolsConfig: PublicKey;
  feeTierPda: PDA;
  funder: PublicKey;
  feeAuthority: PublicKey;
  feeTierIndex: number;
  tickSpacing: number;
  initializePoolAuthority?: PublicKey;
  delegatedFeeAuthority?: PublicKey;
  defaultBaseFeeRate: number;
  presetFilterPeriod: number;
  presetDecayPeriod: number;
  presetReductionFactor: number;
  presetAdaptiveFeeControlFactor: number;
  presetMaxVolatilityAccumulator: number;
  presetTickGroupSize: number;
};

// TODO: comment
export function initializeAdaptiveFeeTierIx(
  program: Program<Whirlpool>,
  params: InitializeAdaptiveFeeTierParams,
): Instruction {
  const ix = program.instruction.initializeAdaptiveFeeTier(
    params.feeTierIndex,
    params.tickSpacing,
    params.initializePoolAuthority ?? PublicKey.default,
    params.delegatedFeeAuthority ?? PublicKey.default,
    params.defaultBaseFeeRate,
    params.presetFilterPeriod,
    params.presetDecayPeriod,
    params.presetReductionFactor,
    params.presetAdaptiveFeeControlFactor,
    params.presetMaxVolatilityAccumulator,
    params.presetTickGroupSize,
    {
    accounts: {
      whirlpoolsConfig: params.whirlpoolsConfig,
      adaptiveFeeTier: params.feeTierPda.publicKey,
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
