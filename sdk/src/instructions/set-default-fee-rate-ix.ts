import { WhirlpoolContext } from "../context";
import { TransformableInstruction } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { transformTx } from "../utils/instructions-util";
import { PDAUtil } from "../utils/public";

/**
 * Parameters to set the default fee rate for a FeeTier.
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig this fee-tier is initialized in
 * @param feeAuthority - Authority authorized in the WhirlpoolsConfig to set default fee rates.
 * @param tickSpacing - The tick spacing of the fee-tier that we would like to update.
 * @param defaultFeeRate - The new default fee rate for this fee-tier. Stored as a hundredths of a basis point.
 */
export type SetDefaultFeeRateParams = {
  whirlpoolsConfig: PublicKey;
  feeAuthority: PublicKey;
  tickSpacing: number;
  defaultFeeRate: number;
};

/**
 * Updates a fee tier account with a new default fee rate. The new rate will not retroactively update
 * initialized pools.
 *
 * #### Special Errors
 * - `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetDefaultFeeRateParams object
 * @returns - Instruction to perform the action.
 */
export function setDefaultFeeRateIx(
  context: WhirlpoolContext,
  params: SetDefaultFeeRateParams
): TransformableInstruction {
  const { whirlpoolsConfig, feeAuthority, tickSpacing, defaultFeeRate } = params;

  const feeTierPda = PDAUtil.getFeeTier(context.program.programId, whirlpoolsConfig, tickSpacing);

  const ix = context.program.instruction.setDefaultFeeRate(defaultFeeRate, {
    accounts: {
      whirlpoolsConfig,
      feeTier: feeTierPda.publicKey,
      feeAuthority,
    },
  });

  return transformTx(context, {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  });
}
