import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../artifacts/whirlpool";

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
  program: Program<Whirlpool>,
  params: CollectProtocolFeesParams,
): Instruction {
  const {
    whirlpoolsConfig,
    whirlpool,
    collectProtocolFeesAuthority,
    tokenVaultA,
    tokenVaultB,
    tokenOwnerAccountA: tokenDestinationA,
    tokenOwnerAccountB: tokenDestinationB,
  } = params;

  const ix = program.instruction.collectProtocolFees({
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

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
