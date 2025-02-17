import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to set fee rate for a Whirlpool by the delegated fee authority.
 *
 * @category Instruction Types
 * @param whirlpool - PublicKey for the whirlpool to update. This whirlpool has to be part of the provided WhirlpoolsConfig space.
 * @param adaptiveFeeTier - The public key for the AdaptiveFeeTier this pool is initialized with.
 * @param delegatedFeeAuthority - Delegated authority authorized in the AdaptiveFeeTier to set fee rates.
 * @param feeRate - The new fee rate for this whirlpool. Stored as a hundredths of a basis point.
 */
export type SetFeeRateByDelegatedFeeAuthorityParams = {
  whirlpool: PublicKey;
  adaptiveFeeTier: PublicKey;
  delegatedFeeAuthority: PublicKey;
  feeRate: number;
};

/**
 * Sets the fee rate for a Whirlpool by the delegated fee authority.
 * Only the current delegated fee authority has permission to invoke this instruction.
 *
 * #### Special Errors
 * - `FeeRateMaxExceeded` - If the provided fee_rate exceeds MAX_FEE_RATE.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetFeeRateByDelegatedFeeAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setFeeRateByDelegatedFeeAuthorityIx(
  program: Program<Whirlpool>,
  params: SetFeeRateByDelegatedFeeAuthorityParams,
): Instruction {
  const { whirlpool, adaptiveFeeTier, delegatedFeeAuthority, feeRate } = params;

  const ix = program.instruction.setFeeRateByDelegatedFeeAuthority(feeRate, {
    accounts: {
      whirlpool,
      adaptiveFeeTier,
      delegatedFeeAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
