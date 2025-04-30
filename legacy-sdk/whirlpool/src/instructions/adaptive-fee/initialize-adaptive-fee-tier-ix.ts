import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import type { Instruction, PDA } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to initialize an AdaptiveFeeTier account.
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - PublicKey for the whirlpool config space that the adaptive fee-tier will be initialized for.
 * @param feeTierPda - PDA for the adaptive fee-tier account that will be initialized
 * @param funder - The account that would fund the creation of this account
 * @param feeAuthority - Authority authorized to initialize fee-tiers and set customs fees.
 * @param feeTierIndex - The index of the fee-tier in the whirlpools config.
 * @param tickSpacing - The tick spacing of this fee tier.
 * @param initializePoolAuthority - The initialize pool authority in the AdaptiveFeeTier
 * @param delegatedFeeAuthority - The delegated fee authority in the AdaptiveFeeTier
 * @param defaultBaseFeeRate - The default base fee rate for this adaptive fee-tier. Stored as a hundredths of a basis point.
 * @param presetFilterPeriod - The filter period for the adaptive fee
 * @param presetDecayPeriod - The decay period for the adaptive fee
 * @param presetReductionFactor - The reduction factor for the adaptive fee
 * @param presetAdaptiveFeeControlFactor - The control factor for the adaptive fee
 * @param presetMaxVolatilityAccumulator - The max volatility accumulator for the adaptive fee
 * @param presetTickGroupSize - The tick group size for the adaptive fee
 * @param presetMajorSwapThresholdTicks - The major swap threshold ticks to define major swap
 */
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
  presetMajorSwapThresholdTicks: number;
};

/**
 * Initializes an adaptive fee tier account usable by Whirlpools in this WhirlpoolsConfig space.
 *
 *  Special Errors
 * `FeeRateMaxExceeded` - If the provided default_base_fee_rate exceeds MAX_FEE_RATE.
 * `InvalidAdaptiveFeeConstants` - If the provided adaptive fee constants are invalid
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - InitializeAdaptiveFeeTierParams object
 * @returns - Instruction to perform the action.
 */
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
    params.presetMajorSwapThresholdTicks,
    {
      accounts: {
        whirlpoolsConfig: params.whirlpoolsConfig,
        adaptiveFeeTier: params.feeTierPda.publicKey,
        funder: params.funder,
        feeAuthority: params.feeAuthority,
        systemProgram: anchor.web3.SystemProgram.programId,
      },
    },
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
