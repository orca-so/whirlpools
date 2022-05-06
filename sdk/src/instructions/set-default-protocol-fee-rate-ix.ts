import { WhirlpoolContext } from "../context";
import { TransformableInstruction } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { transformTx } from "../utils/instructions-util";

/**
 * Parameters to set the default fee rate for a FeeTier.
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig this pool is initialized in
 * @param feeAuthority - Authority authorized in the WhirlpoolsConfig to set default fee rates.
 * @param defaultProtocolFeeRate - The new default protocol fee rate for this config. Stored as a basis point of the total fees collected by feeRate.
 */
export type SetDefaultProtocolFeeRateParams = {
  whirlpoolsConfig: PublicKey;
  feeAuthority: PublicKey;
  defaultProtocolFeeRate: number;
};

/**
 * Updates a WhirlpoolsConfig with a new default protocol fee rate. The new rate will not retroactively update
 * initialized pools.
 *
 * #### Special Errors
 * - `ProtocolFeeRateMaxExceeded` - If the provided default_protocol_fee_rate exceeds MAX_PROTOCOL_FEE_RATE.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetDefaultFeeRateParams object
 * @returns - Instruction to perform the action.
 */
export function setDefaultProtocolFeeRateIx(
  context: WhirlpoolContext,
  params: SetDefaultProtocolFeeRateParams
): TransformableInstruction {
  const { whirlpoolsConfig, feeAuthority, defaultProtocolFeeRate } = params;

  const ix = context.program.instruction.setDefaultProtocolFeeRate(defaultProtocolFeeRate, {
    accounts: {
      whirlpoolsConfig,
      feeAuthority,
    },
  });

  return transformTx(context, {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  });
}
