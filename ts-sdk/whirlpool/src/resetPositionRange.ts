import {
  fetchPosition,
  fetchWhirlpool,
  getPositionAddress,
  getResetPositionRangeInstruction,
} from "@orca-so/whirlpools-client";
import type {
  Address,
  GetAccountInfoApi,
  GetEpochInfoApi,
  GetMinimumBalanceForRentExemptionApi,
  GetMultipleAccountsApi,
  Rpc,
  IInstruction,
  TransactionSigner,
} from "@solana/kit";
import { DEFAULT_ADDRESS, FUNDER } from "./config";
import { fetchMaybeMint } from "@solana-program/token-2022";
import { findAssociatedTokenPda } from "@solana-program/token";
import assert from "assert";
import { getInitializableTickIndex } from "@orca-so/whirlpools-core";

/**
 * Parameters to reset position range.
 *
 * @param positionMintAddress - The address of the position mint.
 * @param newTickLowerIndex - The tick specifying the lower end of the position range.
 * @param newTickUpperIndex - The tick specifying the upper end of the position range.
 */
export type ResetPositionRangeParams = {
  /** The address of the position mint. */
  positionMintAddress: Address;

  // /** The tick specifying the lower end of the position range. */
  // newTickLowerIndex: number;

  // /** The tick specifying the upper end of the position range. */
  // newTickUpperIndex: number;

  /** The new lower price of the position range. */
  newLowerPrice: number;

  /** The new upper price of the position range. */
  newUpperPrice: number;
};

/**
 * Represents the instructions for resetting a position range.
 */
export type ResetPositionRageInstructions = {
  instructions: IInstruction[];
};

/**
 * Generates instructions to reset a position range.
 *
 * @param {SolanaRpc} rpc - The Solana RPC client.
 * @param {ResetPositionRangeParams} params - The parameters for resetting a position range.
 * @param {TransactionSigner} [authority=FUNDER] - The account that authorizes the transaction. Defaults to a predefined funder.
 * @returns {Promise<ResetPositionRageInstructions>} A promise that resolves to an object containing instructions.
 *
 * @example
 * import { resetPositionRangeInstructions } from "@orca-so/whirlpools";
 * import { createSolanaRpc, devnet } from "@solana/kit";
 *
 * await setWhirlpoolsConfig("solanaDevnet");
 * const devnetRpc = createSolanaRpc(devnet("https://api.devnet.solana.com"));
 * const wallet = await loadWallet();
 *
 * const positionMintAddress = address("5uiTr6jPdCXNfBWyfhAS9HScpkhGpoPEsaKcYUDMB2Nw");
 * const newLowerPrice = 300;
 * const newUpperPrice = 400;
 *
 * const instructions = await resetPositionRangeInstructions(
 *   devnetRpc,
 *   {
 *     positionMintAddress,
 *     newLowerPrice,
 *     newUpperPrice,
 *   },
 *   wallet,
 * );
 */
export async function resetPositionRangeInstructions(
  rpc: Rpc<
    GetAccountInfoApi &
      GetMultipleAccountsApi &
      GetMinimumBalanceForRentExemptionApi &
      GetEpochInfoApi
  >,
  params: ResetPositionRangeParams,
  authority: TransactionSigner = FUNDER,
): Promise<ResetPositionRageInstructions> {
  assert(
    authority.address !== DEFAULT_ADDRESS,
    "Either supply an authority or set the default funder",
  );

  const instructions: IInstruction[] = [];

  const positionAddress = await getPositionAddress(params.positionMintAddress);
  const position = await fetchPosition(rpc, positionAddress[0]);
  const positionMint = await fetchMaybeMint(rpc, position.data.positionMint);

  assert(positionMint.exists, "Position mint not found");
  assert(position.data.liquidity === BigInt(0), "Position must be empty");

  const positionTokenAccount = await findAssociatedTokenPda({
    owner: authority.address,
    mint: params.positionMintAddress,
    tokenProgram: positionMint.programAddress,
  });
  const whirlpool = await fetchWhirlpool(rpc, position.data.whirlpool);
  const tickSpacing = whirlpool.data.tickSpacing;

  const newTickLowerIndex = getInitializableTickIndex(
    params.newLowerPrice,
    tickSpacing,
    false,
  );
  const newTickUpperIndex = getInitializableTickIndex(
    params.newUpperPrice,
    tickSpacing,
    true,
  );

  instructions.push(
    getResetPositionRangeInstruction({
      funder: authority,
      positionAuthority: authority,
      position: position.address,
      positionTokenAccount: positionTokenAccount[0],
      newTickLowerIndex: newTickLowerIndex,
      newTickUpperIndex: newTickUpperIndex,
      whirlpool: position.data.whirlpool,
    }),
  );

  return {
    instructions,
  };
}
