import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Instruction, PDA } from "@orca-so/common-sdk";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Whirlpool } from "../../artifacts/whirlpool";

/**
 * Parameters to delete a TokenBadge account.
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - PublicKey for the whirlpools config account
 * @param whirlpoolsConfigExtension - PublicKey for the whirlpools config extension account
 * @param tokenBadgeAuthority - PublicKey for the token badge authority
 * @param tokenBadge - PublicKey for the token badge account to be deleted
 * @param receiver - PublicKey for the account that will receive the rent
 */
export type DeleteTokenBadgeParams = {
  whirlpoolsConfig: PublicKey;
  whirlpoolsConfigExtension: PublicKey;
  tokenBadgeAuthority: PublicKey;
  tokenBadge: PublicKey;
  receiver: PublicKey;
};

/**
 * Deletes a TokenBadge account.
 *
 * @category Instructions
 * @param program - program object containing services required to generate the instruction
 * @param params - DeleteTokenBadgeParams object
 * @returns - Instruction to perform the action.
 */
export function deleteTokenBadgeIx(
  program: Program<Whirlpool>,
  params: DeleteTokenBadgeParams
): Instruction {
  const {
    whirlpoolsConfig,
    whirlpoolsConfigExtension,
    tokenBadgeAuthority,
    tokenBadge,
    receiver,
  } = params;

  const ix = program.instruction.deleteTokenBadge({
    accounts: {
      whirlpoolsConfig,
      whirlpoolsConfigExtension,
      tokenBadgeAuthority,
      tokenBadge,
      receiver,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
