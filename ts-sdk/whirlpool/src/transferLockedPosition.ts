import { getTransferLockedPositionInstruction } from "@orca-so/whirlpools-client";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
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

/**
 * Parameters for transferring a locked position.
 */
export type TransferLockedPositionParam = {
  position: Address;
  positionMint: Address;
  positionTokenAccount: Address;
  detinationTokenAccount: Address;
  lockConfig: Address;
  positionAuthority: Address;
  receiver: Address;
};

/**
 * Instructions for transferring a locked position.
 */
export type TransferLockedPositionInstructions = {
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

  instructions.push(
    getTransferLockedPositionInstruction({
      positionAuthority: authority,
      receiver: param.receiver,
      position: param.position,
      positionTokenAccount: param.positionTokenAccount,
      positionMint: param.positionMint,
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
