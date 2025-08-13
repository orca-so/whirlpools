import type { Program } from "@coral-xyz/anchor";
import type { Instruction } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import type { Whirlpool } from "../../artifacts/whirlpool";
import type { TokenBadgeAttributeData } from "../../types/public";

/**
 * Parameters to set an attribute on a TokenBadge account.
 *
 * @category Instruction Types
 * @param whirlpoolsConfig - PublicKey for the whirlpools config account
 * @param whirlpoolsConfigExtension - PublicKey for the whirlpools config extension account
 * @param tokenBadgeAuthority - PublicKey for the token badge authority
 * @param tokenMint - Publickey for the mint for which the TokenBadge have been initialized
 * @param tokenBadge - PublicKey for the token badge account to be updated
 * @param attribute - The attribute to be set on the TokenBadge account
 */
export type SetTokenBadgeAttributeParams = {
  whirlpoolsConfig: PublicKey;
  whirlpoolsConfigExtension: PublicKey;
  tokenBadgeAuthority: PublicKey;
  tokenMint: PublicKey;
  tokenBadge: PublicKey;
  attribute: TokenBadgeAttributeData;
};

/**
 * Sets an attribute on a TokenBadge account.
 *
 * @category Instructions
 * @param program - program object containing services required to generate the instruction
 * @param params - SetTokenBadgeAttributeParams object
 * @returns - Instruction to perform the action.
 */
export function setTokenBadgeAttributeIx(
  program: Program<Whirlpool>,
  params: SetTokenBadgeAttributeParams,
): Instruction {
  const {
    whirlpoolsConfig,
    whirlpoolsConfigExtension,
    tokenBadgeAuthority,
    tokenMint,
    tokenBadge,
    attribute,
  } = params;

  const ix = program.instruction.setTokenBadgeAttribute(attribute, {
    accounts: {
      whirlpoolsConfig,
      whirlpoolsConfigExtension,
      tokenBadgeAuthority,
      tokenMint,
      tokenBadge,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
