import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to set the default base fee rate for an AdaptiveFeeTier.
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig this fee-tier is initialized in
 * @param feeAuthority - Authority authorized in the WhirlpoolsConfig to set default fee rates.
 * @param adaptiveFeeTier - The tick spacing of the fee-tier that we would like to update.
 * @param defaultBaseFeeRate - The new default base fee rate for this adaptive fee-tier. Stored as a hundredths of a basis point.
 */
export type SetDefaultBaseFeeRateParams = {
  whirlpoolsConfig: PublicKey;
  feeAuthority: PublicKey;
  adaptiveFeeTier: PublicKey;
  defaultBaseFeeRate: number;
};

/**
 * Updates an adaptive fee tier account with a new default base fee rate. The new rate will not retroactively update
 * initialized pools.
 *
 * #### Special Errors
 * - `FeeRateMaxExceeded` - If the provided default_base_fee_rate exceeds MAX_FEE_RATE.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetDefaultBaseFeeRateParams object
 * @returns - Instruction to perform the action.
 */
export function setDefaultBaseFeeRateIx(
  program: Program<Whirlpool>,
  params: SetDefaultBaseFeeRateParams,
): Instruction {
  const {
    whirlpoolsConfig,
    feeAuthority,
    adaptiveFeeTier,
    defaultBaseFeeRate,
  } = params;

  const ix = program.instruction.setDefaultBaseFeeRate(defaultBaseFeeRate, {
    accounts: {
      whirlpoolsConfig,
      adaptiveFeeTier,
      feeAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
