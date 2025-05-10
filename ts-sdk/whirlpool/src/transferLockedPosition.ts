import {
  fetchPosition,
  getPositionAddress,
  getTransferLockedPositionInstruction,
} from "@orca-so/whirlpools-client";
import {
  fetchMaybeMint,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import type {
  Address,
  GetMultipleAccountsApi,
  GetAccountInfoApi,
  IInstruction,
  Rpc,
  GetMinimumBalanceForRentExemptionApi,
  GetEpochInfoApi,
  TransactionSigner,
} from "@solana/kit";
import { FUNDER } from "./config";
import { wrapFunctionWithExecution } from "./actionHelpers";
import assert from "assert";
import { findAssociatedTokenPda } from "@solana-program/token";

/**
 * Parameters for transferring a locked position.
 */
export type TransferLockedPositionParam = {
  /** The address of the position mint. */
  positionMintAddress: Address;

  /** The address of the destination token account. */
  detinationTokenAccount: Address;

  /** The address of the lock config. */
  lockConfig: Address;

  /** The address of the receiver. */
  receiver: Address;
};

/**
 * Instructions for transferring a locked position.
 */
export type TransferLockedPositionInstructions = {
  /** The instructions for transferring a locked position. */
  instructions: IInstruction[];
};

/**
 * Generates instructions to transfer a locked position.
 *
 * @param {SolanaRpc} rpc - The Solana RPC client.
 * @param {TransferLockedPositionParam} param - The parameters for transferring a locked position.
 * @param {TransactionSigner} [authority=FUNDER] - The authority for the transfer.
 * @returns {Promise<TransferLockedPositionInstructions>} - A promise that resolves to an object containing instructions.
 *
 * @example
 * import { transferLockedPositionInstructions, setWhirlpoolsConfig } from '@orca-so/whirlpools';
 * import { createSolanaRpc, devnet, address } from '@solana/kit';
 * import { loadWallet } from './utils';
 *
 * await setWhirlpoolsConfig('solanaDevnet');
 * const wallet = await loadWallet();
 * const positionMint = address("HqoV7Qv27REUtmd9UKSJGGmCRNx3531t33bDG1BUfo9K");
 * const param = {
 *   position: positionMint,
 *   positionMint: positionMint,
 *   positionTokenAccount: positionMint,
 *   detinationTokenAccount: positionMint,
 *   lockConfig: positionMint,
 *   positionAuthority: positionMint,
 *   receiver: positionMint,
 * };
 * const { instructions } = await transferLockedPositionInstructions(
 *   devnetRpc,
 *   param,
 *   wallet
 * );
 *
 * console.log(`Instructions: ${instructions}`);
 */
export async function transferLockedPositionInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi &
      GetEpochInfoApi
  >,
  param: TransferLockedPositionParam,
  authority: TransactionSigner = FUNDER,
): Promise<TransferLockedPositionInstructions> {
  const instructions: IInstruction[] = [];

  const positionAddress = await getPositionAddress(param.positionMintAddress);
  const position = await fetchPosition(rpc, positionAddress[0]);
  const positionMint = await fetchMaybeMint(rpc, position.data.positionMint);

  assert(positionMint.exists, "Position mint not found");

  const positionMintTokenAccount = await findAssociatedTokenPda({
    owner: authority.address,
    mint: param.positionMintAddress,
    tokenProgram: positionMint.programAddress,
  });

  instructions.push(
    getTransferLockedPositionInstruction({
      positionAuthority: authority,
      receiver: param.receiver,
      position: position.address,
      positionTokenAccount: positionMintTokenAccount[0],
      positionMint: param.positionMintAddress,
      destinationTokenAccount: param.detinationTokenAccount,
      lockConfig: param.lockConfig,
      token2022Program: TOKEN_2022_PROGRAM_ADDRESS,
    }),
  );

  return {
    instructions,
  };
}

// -------- ACTIONS --------

export const transferLockedPosition = wrapFunctionWithExecution(
  transferLockedPositionInstructions,
);
