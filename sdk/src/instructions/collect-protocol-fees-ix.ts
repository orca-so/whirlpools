import { WhirlpoolContext } from "../context";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { TransformableInstruction } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { transformTx } from "../utils/instructions-util";

/**
 * Parameters to collect protocol fees for a Whirlpool
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig this pool is initialized in
 * @param whirlpool - PublicKey for the whirlpool that the position will be opened for.
 * @param tokenVaultA - PublicKey for the tokenA vault for this whirlpool.
 * @param tokenVaultB - PublicKey for the tokenB vault for this whirlpool.
 * @param tokenOwnerAccountA - PublicKey for the associated token account for tokenA in the collection wallet
 * @param tokenOwnerAccountB - PublicKey for the associated token account for tokenA in the collection wallet
 * @param collectProtocolFeesAuthority - assigned authority in the WhirlpoolsConfig that can collect protocol fees
 */
export type CollectProtocolFeesParams = {
  whirlpoolsConfig: PublicKey;
  whirlpool: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  collectProtocolFeesAuthority: PublicKey;
};

/**
 * Collect protocol fees accrued in this Whirlpool.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - CollectProtocolFeesParams object
 * @returns - Instruction to perform the action.
 */
export function collectProtocolFeesIx(
  context: WhirlpoolContext,
  params: CollectProtocolFeesParams
): TransformableInstruction {
  const {
    whirlpoolsConfig,
    whirlpool,
    collectProtocolFeesAuthority,
    tokenVaultA,
    tokenVaultB,
    tokenOwnerAccountA: tokenDestinationA,
    tokenOwnerAccountB: tokenDestinationB,
  } = params;

  const ix = context.program.instruction.collectProtocolFees({
    accounts: {
      whirlpoolsConfig,
      whirlpool,
      collectProtocolFeesAuthority,
      tokenVaultA,
      tokenVaultB,
      tokenDestinationA,
      tokenDestinationB,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
  });

  return transformTx(context, {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  });
}
