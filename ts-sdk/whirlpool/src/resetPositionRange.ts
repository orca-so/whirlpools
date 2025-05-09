import { getResetPositionRangeInstruction } from "@orca-so/whirlpools-client";
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

/**
 * Parameters to reset position range.
 *
 * @param funder - The account that create original position.
 * @param positionAuthority - Authority that owns the token corresponding to this desired position.
 * @param position - PublicKey for the position which will be reset.
 * @param positionTokenAccount - The associated token address for the	position token in the owners wallet.
 * @param newTickLowerIndex - The tick specifying the lower end of the position range.
 * @param newTickUpperIndex - The tick specifying the upper end of the position range.
 * @param whirlpool - PublicKey for the whirlpool that the position belongs to.
 */
export type ResetPositionRangeParams = {
  /** The wallet of signer that will pay for the transaction. */
  funder: TransactionSigner<Address>;

  /** The authority that owns the token corresponding to this desired position. */
  positionAuthority: TransactionSigner<Address>;

  /** The address of the position to reset. */
  position: Address;

  /** The associated token address for the position token in the owner's wallet. */
  positionTokenAccount: Address;

  /** The tick specifying the lower end of the position range. */
  newTickLowerIndex: number;

  /** The tick specifying the upper end of the position range. */
  newTickUpperIndex: number;

  /** The address of the whirlpool that the position belongs to. */
  whirlpool: Address;
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
 * const position = address("5uiTr6jPdCXNfBWyfhAS9HScpkhGpoPEsaKcYUDMB2Nw");
 * const positionTokenAccount = address("2t3H9fSEJftE6TS7kgTYqRbnhdRUkCRfxdULybFTgWPu");
 * const whirlpool = address("3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt");
 * const newTickLowerIndex = 300_000;
 * const newTickUpperIndex = 400_000;
 *
 * const instructions = await resetPositionRangeInstructions(
 *   devnetRpc,
 *   {
 *     funder: wallet,
 *     positionAuthority: wallet,
 *     position,
 *     positionTokenAccount,
 *     newTickLowerIndex,
 *     newTickUpperIndex,
 *     whirlpool,
 *   }
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
): Promise<ResetPositionRageInstructions> {
  const instructions: IInstruction[] = [];

  instructions.push(
    getResetPositionRangeInstruction({
      funder: params.funder,
      positionAuthority: params.positionAuthority,
      position: params.position,
      positionTokenAccount: params.positionTokenAccount,
      newTickLowerIndex: params.newTickLowerIndex,
      newTickUpperIndex: params.newTickUpperIndex,
      whirlpool: params.whirlpool,
    }),
  );

  return {
    instructions,
  };
}
