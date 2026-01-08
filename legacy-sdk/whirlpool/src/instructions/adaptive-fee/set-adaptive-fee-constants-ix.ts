import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to set specific adaptive fee constants for a pool
 *
 * @category Instruction Types
 * @param whirlpool - The public key for the Whirlpool
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig
 * @param oracle - The oracle account that will be updated
 * @param feeAuthority - The fee authority from the WhirlpoolsConfig
 * @param filterPeriod - Optional: The filter period for the adaptive fee
 * @param decayPeriod - Optional: The decay period for the adaptive fee
 * @param reductionFactor - Optional: The reduction factor for the adaptive fee
 * @param adaptiveFeeControlFactor - Optional: The control factor for the adaptive fee
 * @param maxVolatilityAccumulator - Optional: The max volatility accumulator for the adaptive fee
 * @param tickGroupSize - Optional: The tick group size for the adaptive fee
 * @param majorSwapThresholdTicks - Optional: The major swap threshold ticks to define major swap
 */
export type SetAdaptiveFeeConstantsParams = {
  whirlpool: PublicKey;
  whirlpoolsConfig: PublicKey;
  oracle: PublicKey;
  feeAuthority: PublicKey;
  filterPeriod?: number;
  decayPeriod?: number;
  reductionFactor?: number;
  adaptiveFeeControlFactor?: number;
  maxVolatilityAccumulator?: number;
  tickGroupSize?: number;
  majorSwapThresholdTicks?: number;
};

/**
 * Sets specific adaptive fee constants for a pool's Oracle.
 * Only the provided constants will be updated, others remain unchanged.
 *
 * #### Special Errors
 * - `InvalidAdaptiveFeeConstants` - If the resulting constants are invalid for the pool's tick_spacing.
 *
 * @category Instructions
 * @param program - Program object containing the Whirlpool IDL
 * @param params - SetAdaptiveFeeConstantsParams object
 * @returns - Instruction to perform the action.
 */
export function setAdaptiveFeeConstantsIx(
  program: Program<Whirlpool>,
  params: SetAdaptiveFeeConstantsParams,
): Instruction {
  const ix = program.instruction.setAdaptiveFeeConstants(
    params.filterPeriod ?? null,
    params.decayPeriod ?? null,
    params.reductionFactor ?? null,
    params.adaptiveFeeControlFactor ?? null,
    params.maxVolatilityAccumulator ?? null,
    params.tickGroupSize ?? null,
    params.majorSwapThresholdTicks ?? null,
    {
      accounts: {
        whirlpool: params.whirlpool,
        whirlpoolsConfig: params.whirlpoolsConfig,
        oracle: params.oracle,
        feeAuthority: params.feeAuthority,
      },
    },
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
