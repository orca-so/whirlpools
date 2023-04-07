import { Instruction } from "@orca-so/common-sdk";
import { PublicKey } from "@solana/web3.js";
import { Program } from "@project-serum/anchor";
import { Whirlpool } from "../artifacts/whirlpool";

/**
 * Parameters to close a bundled position in a Whirlpool.
 *
 * @category Instruction Types
 * @param bundledPosition - PublicKey for the bundled position.
 * @param positionBundle - PublicKey for the position bundle.
 * @param positionBundleTokenAccount - The associated token address for the position bundle token in the owners wallet.
 * @param positionBundleAuthority - authority that owns the token corresponding to this desired bundled position.
 * @param bundleIndex - The bundle index that holds the bundled position.
 * @param receiver - PublicKey for the wallet that will receive the rented lamports.
 */
export type CloseBundledPositionParams = {
  bundledPosition: PublicKey;
  positionBundle: PublicKey;
  positionBundleTokenAccount: PublicKey;
  positionBundleAuthority: PublicKey;
  bundleIndex: number;
  receiver: PublicKey;
};

/**
 * Close a bundled position in a Whirlpool.
 * 
 * #### Special Errors
 * `InvalidBundleIndex` - If the provided bundle index is out of bounds.
 * `ClosePositionNotEmpty` - The provided position account is not empty.
 *
 * @category Instructions
 * @param program - program object containing services required to generate the instruction
 * @param params - CloseBundledPositionParams object
 * @returns - Instruction to perform the action.
 */
export function closeBundledPositionIx(
  program: Program<Whirlpool>,
  params: CloseBundledPositionParams
): Instruction {
  const {
    bundledPosition,
    positionBundle,
    positionBundleTokenAccount,
    positionBundleAuthority,
    bundleIndex,
    receiver,
  } = params;

  const ix = program.instruction.closeBundledPosition(bundleIndex, {
    accounts: {
      bundledPosition,
      positionBundle,
      positionBundleTokenAccount,
      positionBundleAuthority,
      receiver,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
