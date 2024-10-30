import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";
import type { OpenPositionParams, OpenPositionWithTokenExtensionsParams } from "../instructions";

export function openPositionAccounts(params: OpenPositionParams) {
  const {
    funder,
    owner,
    positionPda,
    positionMintAddress,
    positionTokenAccount: positionTokenAccountAddress,
    whirlpool: whirlpoolKey,
  } = params;
  return {
    funder: funder,
    owner,
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

export function openPositionWithTokenExtensionsAccounts(params: OpenPositionWithTokenExtensionsParams) {
  const {
    funder,
    owner,
    positionPda,
    positionMint,
    positionTokenAccount,
    whirlpool: whirlpoolKey,
  } = params;
  return {
    funder: funder,
    owner,
    position: positionPda.publicKey,
    positionMint,
    positionTokenAccount,
    whirlpool: whirlpoolKey,
    token2022Program: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  };
}
