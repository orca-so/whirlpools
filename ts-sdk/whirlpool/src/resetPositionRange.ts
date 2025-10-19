import {
  fetchPosition,
  fetchWhirlpool,
  getPositionAddress,
  getResetPositionRangeInstruction,
} from "@orca-so/whirlpools-client";
import type {
  Address,
  GetAccountInfoApi,
  Rpc,
  Instruction,
  TransactionSigner,
  GetMultipleAccountsApi,
} from "@solana/kit";
import { DEFAULT_ADDRESS, FUNDER } from "./config";
import {
  fetchAllMint,
  fetchMaybeMint,
  findAssociatedTokenPda,
} from "@solana-program/token-2022";
import assert from "assert";
import {
  getInitializableTickIndex,
  priceToTickIndex,
} from "@orca-so/whirlpools-core";

/**
 * Represents the instructions for resetting a position range.
 */
export type ResetPositionRageInstructions = {
  instructions: Instruction[];
};

/**
 * Generates instructions to reset a position range.
 *
 * @param {SolanaRpc} rpc - The Solana RPC client.
 * @param {Address} positionMintAddress - The address of the position mint.
 * @param {number} newLowerPrice - The new lower price of the position.
 * @param {number} newUpperPrice - The new upper price of the position.
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
 *   positionMintAddress,
 *   newLowerPrice,
 *   newUpperPrice,
 *   wallet,
 * );
 */
export async function resetPositionRangeInstructions(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>,
  positionMintAddress: Address,
  newLowerPrice: number,
  newUpperPrice: number,
  authority: TransactionSigner = FUNDER,
): Promise<ResetPositionRageInstructions> {
  assert(
    authority.address !== DEFAULT_ADDRESS,
    "Either supply an authority or set the default funder",
  );

  const instructions: Instruction[] = [];

  const positionAddress = await getPositionAddress(positionMintAddress);
  const position = await fetchPosition(rpc, positionAddress[0]);
  const positionMint = await fetchMaybeMint(rpc, position.data.positionMint);

  assert(positionMint.exists, "Position mint not found");
  assert(position.data.liquidity === BigInt(0), "Position must be empty");

  const positionTokenAccount = await findAssociatedTokenPda({
    owner: authority.address,
    mint: positionMintAddress,
    tokenProgram: positionMint.programAddress,
  });
  const whirlpool = await fetchWhirlpool(rpc, position.data.whirlpool);
  const tickSpacing = whirlpool.data.tickSpacing;

  const [tokenA, tokenB] = await fetchAllMint(rpc, [
    whirlpool.data.tokenMintA,
    whirlpool.data.tokenMintB,
  ]);

  const newLowerTickIndex = priceToTickIndex(
    newLowerPrice,
    tokenA.data.decimals,
    tokenB.data.decimals,
  );
  const newUpperTickIndex = priceToTickIndex(
    newUpperPrice,
    tokenA.data.decimals,
    tokenB.data.decimals,
  );

  const newInitializableTickLowerIndex = getInitializableTickIndex(
    newLowerTickIndex,
    tickSpacing,
    false,
  );
  const newInitializableTickUpperIndex = getInitializableTickIndex(
    newUpperTickIndex,
    tickSpacing,
    true,
  );

  instructions.push(
    getResetPositionRangeInstruction({
      funder: authority,
      positionAuthority: authority,
      position: position.address,
      positionTokenAccount: positionTokenAccount[0],
      newTickLowerIndex: newInitializableTickLowerIndex,
      newTickUpperIndex: newInitializableTickUpperIndex,
      whirlpool: position.data.whirlpool,
    }),
  );

  return {
    instructions,
  };
}
