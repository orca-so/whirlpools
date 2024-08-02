import { Program } from "@coral-xyz/anchor";
import { Instruction } from "@orca-so/common-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { Whirlpool } from "../artifacts/whirlpool";

/**
 * Parameters to delete a PositionBundle account.
 *
 * @category Instruction Types
 * @param owner - PublicKey for the wallet that owns the position bundle token.
 * @param positionBundle - PublicKey for the position bundle.
 * @param positionBundleMint - PublicKey for the mint for the position bundle token.
 * @param positionBundleTokenAccount - The associated token address for the position bundle token in the owners wallet.
 * @param receiver - PublicKey for the wallet that will receive the rented lamports.
 */
export type DeletePositionBundleParams = {
  owner: PublicKey;
  positionBundle: PublicKey;
  positionBundleMint: PublicKey;
  positionBundleTokenAccount: PublicKey;
  receiver: PublicKey;
};

/**
 * Deletes a PositionBundle account.
 *
 * #### Special Errors
 * `PositionBundleNotDeletable` - The provided position bundle has open positions.
 *
 * @category Instructions
 * @param program - program object containing services required to generate the instruction
 * @param params - DeletePositionBundleParams object
 * @returns - Instruction to perform the action.
 */
export function deletePositionBundleIx(
  program: Program<Whirlpool>,
  params: DeletePositionBundleParams
): Instruction {
  const { owner, positionBundle, positionBundleMint, positionBundleTokenAccount, receiver } =
    params;

  const ix = program.instruction.deletePositionBundle({
    accounts: {
      positionBundle: positionBundle,
      positionBundleMint: positionBundleMint,
      positionBundleTokenAccount,
      positionBundleOwner: owner,
      receiver,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
