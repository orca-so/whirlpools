import { Percentage, TransactionBuilder } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import { WhirlpoolContext } from "./context";
import { AccountFetcher } from "./network/public";
import {
  WhirlpoolData,
  PositionData,
  IncreaseLiquidityInput,
  DecreaseLiquidityInput,
} from "./types/public";
import { TokenInfo } from "./types/public/client-types";
import { PublicKey } from "@solana/web3.js";
import { SwapQuote } from "./quotes/public";
import { WhirlpoolClientImpl } from "./impl/whirlpool-client-impl";

/**
 * Helper class to help interact with Whirlpool Accounts with a simpler interface.
 *
 * @category Core
 */
export interface WhirlpoolClient {
  /**
   * Get a Whirlpool object to interact with the Whirlpool account at the given address.
   * @param poolAddress the address of the Whirlpool account
   * @return a Whirlpool object to interact with
   */
  getPool: (poolAddress: Address) => Promise<Whirlpool>;

  /**
   * Get a Position object to interact with the Position account at the given address.
   * @param positionAddress the address of the Position account
   * @return a Position object to interact with
   */
  getPosition: (positionAddress: Address) => Promise<Position>;
}

/**
 * Construct a WhirlpoolClient instance to help interact with Whirlpools accounts with.
 *
 * @category WhirlpoolClient
 * @param ctx - WhirlpoolContext object
 * @param fetcher - AccountFetcher instance to help fetch data with.
 * @returns a WhirlpoolClient instance to help with interacting with Whirlpools accounts.
 */
export function buildWhirlpoolClient(ctx: WhirlpoolContext, fetcher: AccountFetcher) {
  return new WhirlpoolClientImpl(ctx, fetcher);
}

/**
 * Helper class to interact with a Whirlpool account and build complex transactions.
 * @category WhirlpoolClient
 */
export interface Whirlpool {
  /**
   * Return the most recently fetched Whirlpool account data.
   * @return most recently fetched WhirlpoolData for this address.
   */
  getData: () => WhirlpoolData;

  /**
   * Fetch and return the most recently fetched Whirlpool account data.
   * @return the most up to date WhirlpoolData for this address.
   */
  refreshData: () => Promise<WhirlpoolData>;

  /**
   * Get the TokenInfo for token A of this pool.
   * @return TokenInfo for token A
   */
  getTokenAInfo: () => TokenInfo;

  /**
   * Get the TokenInfo for token B of this pool.
   * @return TokenInfo for token B
   */
  getTokenBInfo: () => TokenInfo;

  // TODO: add functionality to check whether tick arrays exists
  /**
   * Initialize a set of tick-arrays to support the provided ticks.
   *
   * This function does not ensure the provided tick index are within range and not initialized.
   *
   * If `funder` is provided, the funder wallet has to sign this transaction.
   *
   * @param ticks - A group of ticks that define the desired tick-arrays to initialize
   * @param funder - optional - the wallet that will fund the cost needed to initialize the position. If null, the WhirlpoolContext wallet is used.
   * @return a transaction that will initialize the defined tick-arrays if executed.
   */
  initTickArrayForTicks: (ticks: number[], funder?: Address) => TransactionBuilder;

  /**
   * Open and fund a position on this Whirlpool.
   *
   * User has to ensure the TickArray for tickLower and tickUpper has been initialized prior to calling this function.
   *
   * If `funder` is provided, the funder wallet has to sign this transaction.
   *
   * @param tickLower - the tick index for the lower bound of this position
   * @param tickUpper - the tick index for the upper bound of this position
   * @param liquidityInput - an InputLiquidityInput type to define the desired liquidity amount to deposit
   * @param sourceWallet - optional - the wallet to withdraw tokens to deposit into the position. If null, the WhirlpoolContext wallet is used.
   * @param positionWallet - optional - the wallet to that houses the position token. If null, the WhirlpoolContext wallet is used.
   * @param funder - optional - the wallet that will fund the cost needed to initialize the position. If null, the WhirlpoolContext wallet is used.
   * @return `positionMint` - the position to be created. `tx` - The transaction containing the instructions to perform the operation on chain.
   */
  openPosition: (
    tickLower: number,
    tickUpper: number,
    liquidityInput: IncreaseLiquidityInput,
    sourceWallet?: Address,
    positionWallet?: Address,
    funder?: Address
  ) => Promise<{ positionMint: PublicKey; tx: TransactionBuilder }>;

  /**
   * Open and fund a position with meta-data on this Whirlpool.
   *
   * User has to ensure the TickArray for tickLower and tickUpper has been initialized prior to calling this function.
   *
   * If `sourceWallet`, `positionWallet` or `funder` is provided, the wallet owners have to sign this transaction.
   *
   * @param tickLower - the tick index for the lower bound of this position
   * @param tickUpper - the tick index for the upper bound of this position
   * @param liquidityInput - input that defines the desired liquidity amount and maximum tokens willing to be to deposited.
   * @param sourceWallet - optional - the wallet to withdraw tokens to deposit into the position. If null, the WhirlpoolContext wallet is used.
   * @param positionWallet - optional - the wallet to that houses the position token. If null, the WhirlpoolContext wallet is used.
   * @param funder - optional - the wallet that will fund the cost needed to initialize the position. If null, the WhirlpoolContext wallet is used.
   * @return `positionMint` - the position to be created. `tx` - The transaction containing the instructions to perform the operation on chain.
   */
  openPositionWithMetadata: (
    tickLower: number,
    tickUpper: number,
    liquidityInput: IncreaseLiquidityInput,
    sourceWallet?: Address,
    positionWallet?: Address,
    funder?: Address
  ) => Promise<{ positionMint: PublicKey; tx: TransactionBuilder }>;

  /**
   * Withdraw all tokens from a position, close the account and burn the position token.
   *
   * Users have to collect all fees and rewards from this position prior to closing the account.
   *
   * If `positionWallet` is provided, the wallet owner has to sign this transaction.
   *
   * @param positionAddress - The address of the position account.
   * @param slippageTolerance - The amount of slippage the caller is willing to accept when withdrawing liquidity.
   * @param destinationWallet - optional - The wallet that the tokens withdrawn will be sent to. If null, the WhirlpoolContext wallet is used.
   * @param positionWallet - optional - The wallet that houses the position token that corresponds to this position address. If null, the WhirlpoolContext wallet is used.
   */
  closePosition: (
    positionAddress: Address,
    slippageTolerance: Percentage,
    destinationWallet?: Address,
    positionWallet?: Address
  ) => Promise<TransactionBuilder>;

  /**
   * Perform a swap between tokenA and tokenB on this pool.
   *
   * @param quote - A quote on the desired tokenIn and tokenOut for this swap. Use @link {swapQuote} to generate this object.
   * @param wallet - The wallet that tokens will be withdrawn and deposit into. If null, the WhirlpoolContext wallet is used.
   * @return a transaction that will perform the swap once executed.
   */
  swap: (quote: SwapQuote, wallet?: PublicKey) => Promise<TransactionBuilder>;
}

/**
 * Helper class to interact with a Position account and build complex transactions.
 * @category WhirlpoolClient
 */
export interface Position {
  /**
   * Return the most recently fetched Position account data.
   * @return most recently fetched PositionData for this address.
   */
  getData: () => PositionData;

  /**
   * Fetch and return the most recently fetched Position account data.
   * @return the most up to date PositionData for this address.
   */
  refreshData: () => Promise<PositionData>;

  /**
   * Deposit additional tokens into this postiion.
   *
   * If `sourceWallet`, `positionWallet` is provided, the wallet owners have to sign this transaction.
   *
   * @param liquidityInput - input that defines the desired liquidity amount and maximum tokens willing to be to deposited.
   * @param sourceWallet - optional - the wallet to withdraw tokens to deposit into the position. If null, the WhirlpoolContext wallet is used.
   * @param positionWallet - optional - the wallet to that houses the position token. If null, the WhirlpoolContext wallet is used.
   * @return the transaction that will deposit the tokens into the position when executed.
   */
  increaseLiquidity: (
    liquidityInput: IncreaseLiquidityInput,
    sourceWallet?: Address,
    positionWallet?: Address
  ) => Promise<TransactionBuilder>;

  /**
   * Withdraw liquidity from this position.
   *
   * If `positionWallet` is provided, the wallet owners have to sign this transaction.
   *
   * @param liquidityInput - input that defines the desired liquidity amount and minimum tokens willing to be to withdrawn from the position.
   * @param sourceWallet - optional - the wallet to deposit tokens into when withdrawing from the position. If null, the WhirlpoolContext wallet is used.
   * @param positionWallet - optional - the wallet to that houses the position token. If null, the WhirlpoolContext wallet is used.
   * @return the transaction that will deposit the tokens into the position when executed.
   */
  decreaseLiquidity: (
    liquidityInput: DecreaseLiquidityInput,
    sourceWallet?: Address,
    positionWallet?: Address
  ) => Promise<TransactionBuilder>;

  // TODO: Implement Collect fees
}
