import { Program } from "@project-serum/anchor";
import { Whirlpool } from "../artifacts/whirlpool";
import { Instruction } from "@orca-so/common-sdk";
import * as anchor from "@project-serum/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { PDA } from "@orca-so/common-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { METADATA_PROGRAM_ADDRESS, WHIRLPOOL_NFT_UPDATE_AUTH } from "..";

/**
 * Parameters to initialize a PositionBundle account.
 *
 * @category Instruction Types
 * @param owner - PublicKey for the wallet that will host the minted position bundle token.
 * @param positionBundlePda - PDA for the derived position bundle address.
 * @param positionBundleMintKeypair - Keypair for the mint for the position bundle token.
 * @param positionBundleTokenAccount - The associated token address for the position bundle token in the owners wallet.
 * @param funder - The account that would fund the creation of this account
 */
export type InitializePositionBundleParams = {
  owner: PublicKey;
  positionBundlePda: PDA;
  positionBundleMintKeypair: Keypair;
  positionBundleTokenAccount: PublicKey;
  funder: PublicKey;
};

/**
 * Initializes a PositionBundle account.
 *
 * @category Instructions
 * @param program - program object containing services required to generate the instruction
 * @param params - InitializePositionBundleParams object
 * @returns - Instruction to perform the action.
 */
export function initializePositionBundleIx(
  program: Program<Whirlpool>,
  params: InitializePositionBundleParams
): Instruction {
  const { 
    owner,
    positionBundlePda,
    positionBundleMintKeypair,
    positionBundleTokenAccount,
    funder,  
  } = params;

  const ix = program.instruction.initializePositionBundle({
    accounts: {
      positionBundle: positionBundlePda.publicKey,
      positionBundleMint: positionBundleMintKeypair.publicKey,
      positionBundleTokenAccount,
      positionBundleOwner: owner,
      funder,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [positionBundleMintKeypair],
  };
}

/**
 * Initializes a PositionBundle account.
 * Additional Metaplex metadata is appended to identify the token.
 *
 * @category Instructions
 * @param program - program object containing services required to generate the instruction
 * @param params - InitializePositionBundleParams object
 * @returns - Instruction to perform the action.
 */
 export function initializePositionBundleWithMetadataIx(
  program: Program<Whirlpool>,
  params: InitializePositionBundleParams & { positionBundleMetadataPda: PDA }
): Instruction {
  const { 
    owner,
    positionBundlePda,
    positionBundleMintKeypair,
    positionBundleTokenAccount,
    positionBundleMetadataPda,
    funder,  
  } = params;

  const ix = program.instruction.initializePositionBundleWithMetadata({
    accounts: {
      positionBundle: positionBundlePda.publicKey,
      positionBundleMint: positionBundleMintKeypair.publicKey,
      positionBundleMetadata: positionBundleMetadataPda.publicKey,
      positionBundleTokenAccount,
      positionBundleOwner: owner,
      funder,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      metadataProgram: METADATA_PROGRAM_ADDRESS,
      metadataUpdateAuth: WHIRLPOOL_NFT_UPDATE_AUTH,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [positionBundleMintKeypair],
  };
}
