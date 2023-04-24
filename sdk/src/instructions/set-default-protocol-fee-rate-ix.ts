import { Program } from "@coral-xyz/anchor";
import { Instruction } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { Whirlpool } from "../artifacts/whirlpool";

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
  program: Program<Whirlpool>,
  params: SetDefaultProtocolFeeRateParams
): Instruction {
  const { whirlpoolsConfig, feeAuthority, defaultProtocolFeeRate } = params;

  const ix = program.instruction.setDefaultProtocolFeeRate(defaultProtocolFeeRate, {
    accounts: {
      whirlpoolsConfig,
      feeAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
