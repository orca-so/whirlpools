import { Program } from "@coral-xyz/anchor";
import { Instruction } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { Whirlpool } from "../../artifacts/whirlpool";
import { MEMO_PROGRAM_ADDRESS } from "../..";

/**
 * Parameters to collect protocol fees for a Whirlpool
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - The public key for the WhirlpoolsConfig this pool is initialized in
 * @param whirlpool - PublicKey for the whirlpool that the position will be opened for.
 * @param collectProtocolFeesAuthority - assigned authority in the WhirlpoolsConfig that can collect protocol fees
 * @param tokenMintA - PublicKey for the token A mint.
 * @param tokenMintB - PublicKey for the token B mint.
 * @param tokenVaultA - PublicKey for the tokenA vault for this whirlpool.
 * @param tokenVaultB - PublicKey for the tokenB vault for this whirlpool.
 * @param tokenOwnerAccountA - PublicKey for the associated token account for tokenA in the collection wallet
 * @param tokenOwnerAccountB - PublicKey for the associated token account for tokenA in the collection wallet
 * @param tokenProgramA - PublicKey for the token program for token A.
 * @param tokenProgramB - PublicKey for the token program for token B.
 */
export type CollectProtocolFeesV2Params = {
  whirlpoolsConfig: PublicKey;
  whirlpool: PublicKey;
  collectProtocolFeesAuthority: PublicKey;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  tokenProgramA: PublicKey;
  tokenProgramB: PublicKey;
};

/**
 * Collect protocol fees accrued in this Whirlpool.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - CollectProtocolFeesV2Params object
 * @returns - Instruction to perform the action.
 */
export function collectProtocolFeesV2Ix(
  program: Program<Whirlpool>,
  params: CollectProtocolFeesV2Params
): Instruction {
  const {
    whirlpoolsConfig,
    whirlpool,
    collectProtocolFeesAuthority,
    tokenMintA,
    tokenMintB,
    tokenVaultA,
    tokenVaultB,
    tokenOwnerAccountA: tokenDestinationA,
    tokenOwnerAccountB: tokenDestinationB,
    tokenProgramA,
    tokenProgramB,
  } = params;

  const ix = program.instruction.collectProtocolFeesV2({
    accounts: {
      whirlpoolsConfig,
      whirlpool,
      collectProtocolFeesAuthority,
      tokenMintA,
      tokenMintB,
      tokenVaultA,
      tokenVaultB,
      tokenDestinationA,
      tokenDestinationB,
      tokenProgramA,
      tokenProgramB,
      memoProgram: MEMO_PROGRAM_ADDRESS,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
