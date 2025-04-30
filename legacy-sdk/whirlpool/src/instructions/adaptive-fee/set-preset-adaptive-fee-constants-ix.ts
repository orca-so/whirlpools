import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to set the preset adaptive fee constants in an AdaptiveFeeTier
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig this adaptive fee-tier is initialized in
 * @param feeAuthority - The feeAuthority in the WhirlpoolsConfig
 * @param adaptiveFeeTier - The adaptive fee-tier account that we would like to update
 * @param presetFilterPeriod - The filter period for the adaptive fee
 * @param presetDecayPeriod - The decay period for the adaptive fee
 * @param presetReductionFactor - The reduction factor for the adaptive fee
 * @param presetAdaptiveFeeControlFactor - The control factor for the adaptive fee
 * @param presetMaxVolatilityAccumulator - The max volatility accumulator for the adaptive fee
 * @param presetTickGroupSize - The tick group size for the adaptive fee
 * @param presetMajorSwapThresholdTicks - The major swap threshold ticks to define major swap
 */
export type SetPresetAdaptiveFeeConstantsParams = {
  whirlpoolsConfig: PublicKey;
  feeAuthority: PublicKey;
  adaptiveFeeTier: PublicKey;
  presetFilterPeriod: number;
  presetDecayPeriod: number;
  presetReductionFactor: number;
  presetAdaptiveFeeControlFactor: number;
  presetMaxVolatilityAccumulator: number;
  presetTickGroupSize: number;
  presetMajorSwapThresholdTicks: number;
};

/**
 * Updates an adaptive fee tier account with new preset adaptive fee constants.
 *
 * #### Special Errors
 * - `InvalidAdaptiveFeeConstants` - If the provided adaptive fee constants are invalid.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetPresetAdaptiveFeeConstantsParams object
 * @returns - Instruction to perform the action.
 */
export function setPresetAdaptiveFeeConstantsIx(
  program: Program<Whirlpool>,
  params: SetPresetAdaptiveFeeConstantsParams,
): Instruction {
  const ix = program.instruction.setPresetAdaptiveFeeConstants(
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
        feeAuthority: params.feeAuthority,
        adaptiveFeeTier: params.adaptiveFeeTier,
      },
    },
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
