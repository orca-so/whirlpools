import type { Program } from "@coral-xyz/anchor";
import type { Instruction, PDA } from "@orca-so/common-sdk";
import type { PublicKey } from "@solana/web3.js";
import { WHIRLPOOL_NFT_UPDATE_AUTH } from "..";
import type { Whirlpool } from "../artifacts/whirlpool";
import { openPositionWithTokenExtensionsAccounts } from "../utils/instructions-util";

/**
 * Parameters to open a position (based on Token-2022) in a Whirlpool.
 *
 * @category Instruction Types
 * @param whirlpool - PublicKey for the whirlpool that the position will be opened for.
 * @param ownerKey - PublicKey for the wallet that will host the minted position token.
 * @param positionPda - PDA for the derived position address.
 * @param positionMint - PublicKey for the mint token for the Position token.
 * @param positionTokenAccount - The associated token address for the position token in the owners wallet.
 * @param funder - The account that would fund the creation of this account
 * @param tickLowerIndex - The tick specifying the lower end of the position range.
 * @param tickUpperIndex - The tick specifying the upper end of the position range.
 * @param withTokenMetadataExtension - If true, the position token will have a TokenMetadata extension.
 */
export type OpenPositionWithTokenExtensionsParams = {
  whirlpool: PublicKey;
  owner: PublicKey;
  positionPda: PDA;
  positionMint: PublicKey;
  positionTokenAccount: PublicKey;
  funder: PublicKey;
  tickLowerIndex: number;
  tickUpperIndex: number;
  withTokenMetadataExtension: boolean;
};

/**
 * Open a position in a Whirlpool. A unique token will be minted to represent the position
 * in the users wallet. Additional TokenMetadata extension is initialized to identify the token if requested.
 * Mint and Token account are based on Token-2022.
 * The position will start off with 0 liquidity.
 *
 * #### Special Errors
 * `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of the tick-spacing in this pool.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - OpenPositionWithTokenExtensionsParams object and a derived PDA that hosts the position's metadata.
 * @returns - Instruction to perform the action.
 */
export function openPositionWithTokenExtensionsIx(
  program: Program<Whirlpool>,
  params: OpenPositionWithTokenExtensionsParams,
): Instruction {
  const { tickLowerIndex, tickUpperIndex, withTokenMetadataExtension } = params;

  const ix = program.instruction.openPositionWithTokenExtensions(
    tickLowerIndex,
    tickUpperIndex,
    withTokenMetadataExtension,
    {
      accounts: {
        ...openPositionWithTokenExtensionsAccounts(params),
        metadataUpdateAuth: WHIRLPOOL_NFT_UPDATE_AUTH,
      },
    },
  );

  // TODO: Require Keypair and auto sign this ix
  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
