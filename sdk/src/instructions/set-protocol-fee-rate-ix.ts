import { WhirlpoolContext } from "../context";
import { TransformableInstruction } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { transformTx } from "../utils/instructions-util";

/**
 * Parameters to set fee rate for a Whirlpool.
 *
 * @category Instruction Types
 * @param whirlpool - PublicKey for the whirlpool to update. This whirlpool has to be part of the provided WhirlpoolsConfig space.
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig this pool is initialized in
 * @param feeAuthority - Authority authorized in the WhirlpoolsConfig to set default fee rates.
 * @param protocolFeeRate - The new default protocol fee rate for this pool. Stored as a basis point of the total fees collected by feeRate.
 */
export type SetProtocolFeeRateParams = {
  whirlpool: PublicKey;
  whirlpoolsConfig: PublicKey;
  feeAuthority: PublicKey;
  protocolFeeRate: number;
};

/**
 * Sets the protocol fee rate for a Whirlpool.
 * Only the current fee authority has permission to invoke this instruction.
 *
 * #### Special Errors
 * - `ProtocolFeeRateMaxExceeded` - If the provided default_protocol_fee_rate exceeds MAX_PROTOCOL_FEE_RATE.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetFeeRateParams object
 * @returns - Instruction to perform the action.
 */
export function setProtocolFeeRateIx(
  context: WhirlpoolContext,
  params: SetProtocolFeeRateParams
): TransformableInstruction {
  const { whirlpoolsConfig, whirlpool, feeAuthority, protocolFeeRate } = params;

  const ix = context.program.instruction.setProtocolFeeRate(protocolFeeRate, {
    accounts: {
      whirlpoolsConfig,
      whirlpool,
      feeAuthority,
    },
  });

  return transformTx(context, {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  });
}
