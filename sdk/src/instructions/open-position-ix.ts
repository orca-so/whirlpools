import { WhirlpoolContext } from "../context";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Instruction } from "../utils/transactions/transactions-builder";
import { OpenPositionParams, PDA } from "..";
import * as anchor from "@project-serum/anchor";
import {
  OpenPositionBumpsData,
  OpenPositionWithMetadataBumpsData,
} from "../types/public/anchor-types";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { METADATA_PROGRAM_ADDRESS } from "../utils/public";

export function buildOpenPositionIx(
  context: WhirlpoolContext,
  params: OpenPositionParams
): Instruction {
  const { positionPda, tickLowerIndex, tickUpperIndex } = params;

  const bumps: OpenPositionBumpsData = {
    positionBump: positionPda.bump,
  };

  const ix = context.program.instruction.openPosition(bumps, tickLowerIndex, tickUpperIndex, {
    accounts: openPositionAccounts(params),
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}

export function buildOpenPositionWithMetadataIx(
  context: WhirlpoolContext,
  params: OpenPositionParams & { metadataPda: PDA }
): Instruction {
  const { positionPda, metadataPda, tickLowerIndex, tickUpperIndex } = params;

  const bumps: OpenPositionWithMetadataBumpsData = {
    positionBump: positionPda.bump,
    metadataBump: metadataPda.bump,
  };

  const ix = context.program.instruction.openPositionWithMetadata(
    bumps,
    tickLowerIndex,
    tickUpperIndex,
    {
      accounts: {
        ...openPositionAccounts(params),
        positionMetadataAccount: metadataPda.publicKey,
        metadataProgram: METADATA_PROGRAM_ADDRESS,
        metadataUpdateAuth: new PublicKey("3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr"),
      },
    }
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}

export function openPositionAccounts(params: OpenPositionParams) {
  const {
    funder,
    ownerKey,
    positionPda,
    positionMintAddress,
    positionTokenAccountAddress,
    whirlpoolKey,
  } = params;
  return {
    funder: funder,
    owner: ownerKey,
    position: positionPda.publicKey,
    positionMint: positionMintAddress,
    positionTokenAccount: positionTokenAccountAddress,
    whirlpool: whirlpoolKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  };
}
