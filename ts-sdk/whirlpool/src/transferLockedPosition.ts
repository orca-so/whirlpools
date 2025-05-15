import {
  fetchMaybeLockConfig,
  fetchPosition,
  getPositionAddress,
  getTransferLockedPositionInstruction,
  WHIRLPOOL_PROGRAM_ADDRESS,
} from "@orca-so/whirlpools-client";
import {
  fetchMaybeMint,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import {
  type Address,
  type GetAccountInfoApi,
  type IInstruction,
  type Rpc,
  type TransactionSigner,
  getProgramDerivedAddress,
  getAddressCodec,
} from "@solana/kit";
import { FUNDER } from "./config";
import { wrapFunctionWithExecution } from "./actionHelpers";
import assert from "assert";
import { findAssociatedTokenPda } from "@solana-program/token";

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
 * @param {Address} positionMintAddress - The address of the position mint.
 * @param {Address} receiver - The address of the receiver.
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
 *
 * const { instructions } = await transferLockedPositionInstructions(
 *   devnetRpc,
 *   positionMint,
 *   receiverAddress,
 *   wallet
 * );
 *
 * console.log(`Instructions: ${instructions}`);
 */
export async function transferLockedPositionInstructions(
  rpc: Rpc<GetAccountInfoApi>,
  positionMintAddress: Address,
  receiver: Address,
  authority: TransactionSigner = FUNDER,
): Promise<TransferLockedPositionInstructions> {
  const instructions: IInstruction[] = [];

  const positionAddress = await getPositionAddress(positionMintAddress);
  const position = await fetchPosition(rpc, positionAddress[0]);
  const positionMint = await fetchMaybeMint(rpc, position.data.positionMint);

  assert(positionMint.exists, "Position mint not found");

  const positionMintTokenAccount = await findAssociatedTokenPda({
    owner: authority.address,
    mint: positionMintAddress,
    tokenProgram: positionMint.programAddress,
  });

  const destinationTokenAccount = await findAssociatedTokenPda({
    owner: receiver,
    mint: positionMintAddress,
    tokenProgram: positionMint.programAddress,
  });

  const lockConfigPda = await getProgramDerivedAddress({
    seeds: [
      Buffer.from("lock_config"),
      getAddressCodec().encode(positionAddress[0]),
    ],
    programAddress: WHIRLPOOL_PROGRAM_ADDRESS,
  });

  const lockConfig = await fetchMaybeLockConfig(rpc, lockConfigPda[0]);
  assert(lockConfig.exists, "Lock config not found");

  instructions.push(
    getTransferLockedPositionInstruction({
      positionAuthority: authority,
      receiver: receiver,
      position: position.address,
      positionTokenAccount: positionMintTokenAccount[0],
      positionMint: positionMintAddress,
      destinationTokenAccount: destinationTokenAccount[0],
      lockConfig: lockConfig.address,
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
