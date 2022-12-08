import { Percentage, TransactionBuilder } from "@orca-so/common-sdk";
import { Address } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import { WhirlpoolContext } from "./context";
import { WhirlpoolClientImpl } from "./impl/whirlpool-client-impl";
import { DevFeeSwapInput, SwapInput } from "./instructions";
import { AccountFetcher } from "./network/public";
import {
  DecreaseLiquidityInput,
  IncreaseLiquidityInput,
  PositionData,
  TickData,
  WhirlpoolData,
} from "./types/public";
import { TokenAccountInfo, TokenInfo, WhirlpoolRewardInfo } from "./types/public/client-types";

/**
 * Helper class to help interact with Whirlpool Accounts with a simpler interface.
 *
 * @category Core
 */
export interface WhirlpoolClient {
  /**
   * Get this client's WhirlpoolContext object
   * @return a WhirlpoolContext object
   */
  getContext: () => WhirlpoolContext;

  /**
   * Get an AccountFetcher to fetch Whirlpool accounts
   * @return an AccountFetcher instance
   */
  getFetcher: () => AccountFetcher;

  /**
   * Get a Whirlpool object to interact with the Whirlpool account at the given address.
   * @param poolAddress the address of the Whirlpool account
   * @param refresh true to always request newest data from chain with this request
   * @return a Whirlpool object to interact with
   */
  getPool: (poolAddress: Address, refresh?: boolean) => Promise<Whirlpool>;

  /**
   * Get a list of Whirlpool objects matching the provided list of addresses.
   * @param poolAddresses the addresses of the Whirlpool accounts
   * @param refresh true to always request newest data from chain with this request
   * @return a list of Whirlpool objects to interact with
   */
  getPools: (poolAddresses: Address[], refresh?: boolean) => Promise<Whirlpool[]>;

  /**
   * Get a Position object to interact with the Position account at the given address.
   * @param positionAddress the address of the Position account
   * @param refresh true to always request newest data from chain with this request
   * @return a Position object to interact with.
   * @throws error when address does not return a Position account.
   */
  getPosition: (positionAddress: Address, refresh?: boolean) => Promise<Position>;

  /**
   * Get a list of Position objects to interact with the Position account at the given addresses.
   * @param positionAddress the addresses of the Position accounts
   * @param refresh true to always request newest data from chain with this request
   * @return a Record object between account address and Position. If an address is not a Position account, it will be null.
   */
  getPositions: (
    positionAddresses: Address[],
    refresh?: boolean
  ) => Promise<Record<string, Position | null>>;

  /**
   * Collect all fees and rewards from a list of positions.
   * @experimental
   * @param positionAddress the addresses of the Position accounts to collect fee & rewards from.
   * @param refresh true to always request newest data from chain with this request
   * @returns A set of transaction-builders to resolve ATA for affliated tokens, collect fee & rewards for all positions.
   *          The first transaction should always be processed as it contains all the resolve ATA instructions to receive tokens.
   */
  collectFeesAndRewardsForPositions: (
    positionAddresses: Address[],
    refresh?: boolean
  ) => Promise<TransactionBuilder[]>;

  /**
   * Create a Whirlpool account for a group of token A, token B and tick spacing
   * @param whirlpoolConfig the address of the whirlpool config
   * @param tokenMintA the address of the token A
   * @param tokenMintB the address of the token B
   * @param tickSpacing the space between two ticks in the tick array
   * @param initialTick the initial tick that the pool is set to (derived from initial price)
   * @param funder the account to debit SOL from to fund the creation of the account(s)
   * @return `poolKey`: The public key of the newly created whirlpool account. `tx`: The transaction containing instructions for the on-chain operations.
   * @throws error when the tokens are not in the canonical byte-based ordering. To resolve this, invert the token order and the initialTick (see `TickUtil.invertTick()`, `PriceMath.invertSqrtPriceX64()`, or `PriceMath.invertPrice()`).
   */
  createPool: (
    whirlpoolsConfig: Address,
    tokenMintA: Address,
    tokenMintB: Address,
    tickSpacing: number,
    initialTick: number,
    funder: Address
  ) => Promise<{ poolKey: PublicKey; tx: TransactionBuilder }>;
}

/**
 * Construct a WhirlpoolClient instance to help interact with Whirlpools accounts with.
 *
 * @category WhirlpoolClient
 * @param ctx - WhirlpoolContext object
 * @returns a WhirlpoolClient instance to help with interacting with Whirlpools accounts.
 */
export function buildWhirlpoolClient(ctx: WhirlpoolContext): WhirlpoolClient {
  return new WhirlpoolClientImpl(ctx);
}

/**
 * Helper class to interact with a Whirlpool account and build complex transactions.
 * @category WhirlpoolClient
 */
export interface Whirlpool {
  /**
   * Return the address for this Whirlpool instance.
   * @return the PublicKey for this Whirlpool instance.
   */
  getAddress: () => PublicKey;

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

  /**
   * Get the TokenAccountInfo for token vault A of this pool.
   * @return TokenAccountInfo for token vault A
   */
  getTokenVaultAInfo: () => TokenAccountInfo;

  /**
   * Get the TokenAccountInfo for token vault B of this pool.
   * @return TokenAccountInfo for token vault B
   */
  getTokenVaultBInfo: () => TokenAccountInfo;

  /**
   * Get the WhirlpoolRewardInfos for this pool.
   * @return Array of 3 WhirlpoolRewardInfos. However, not all of them may be initialized. Use the initialized field on WhirlpoolRewardInfo to check if the reward is active.
   */
  getRewardInfos: () => WhirlpoolRewardInfo[];

  /**
   * Initialize a set of tick-arrays that encompasses the provided ticks.
   *
   * If `funder` is provided, the funder wallet has to sign this transaction.
   *
   * @param ticks - A group of ticks that define the desired tick-arrays to initialize. If the tick's array has been initialized, it will be ignored.
   * @param funder - the wallet that will fund the cost needed to initialize the position. If null, the WhirlpoolContext wallet is used.
   * @param refresh - whether this operation will fetch for the latest accounts if a cache version is available.
   * @return a transaction that will initialize the defined tick-arrays if executed. Return null if all of the tick's arrays are initialized.
   */
  initTickArrayForTicks: (
    ticks: number[],
    funder?: Address,
    refresh?: boolean
  ) => Promise<TransactionBuilder | null>;

  /**
   * Open and fund a position on this Whirlpool.
   *
   * User has to ensure the TickArray for tickLower and tickUpper has been initialized prior to calling this function.
   *
   * If `wallet` or `funder` is provided, those wallets have to sign this transaction.
   *
   * @param tickLower - the tick index for the lower bound of this position
   * @param tickUpper - the tick index for the upper bound of this position
   * @param liquidityInput - an InputLiquidityInput type to define the desired liquidity amount to deposit
   * @param wallet - the wallet to withdraw tokens to deposit into the position and house the position token. If null, the WhirlpoolContext wallet is used.
   * @param funder - the wallet that will fund the cost needed to initialize the position. If null, the WhirlpoolContext wallet is used.
   * @return `positionMint` - the position to be created. `tx` - The transaction containing the instructions to perform the operation on chain.
   */
  openPosition: (
    tickLower: number,
    tickUpper: number,
    liquidityInput: IncreaseLiquidityInput,
    wallet?: Address,
    funder?: Address
  ) => Promise<{ positionMint: PublicKey; tx: TransactionBuilder }>;

  /**
   * Open and fund a position with meta-data on this Whirlpool.
   *
   * User has to ensure the TickArray for tickLower and tickUpper has been initialized prior to calling this function.
   *
   * If `wallet` or `funder` is provided, the wallet owners have to sign this transaction.
   *
   * @param tickLower - the tick index for the lower bound of this position
   * @param tickUpper - the tick index for the upper bound of this position
   * @param liquidityInput - input that defines the desired liquidity amount and maximum tokens willing to be to deposited.
   * @param wallet - the wallet to withdraw tokens to deposit into the position and house the position token. If null, the WhirlpoolContext wallet is used.
   * @param funder - the wallet that will fund the cost needed to initialize the position. If null, the WhirlpoolContext wallet is used.
   * @return `positionMint` - the position to be created. `tx` - The transaction containing the instructions to perform the operation on chain.
   */
  openPositionWithMetadata: (
    tickLower: number,
    tickUpper: number,
    liquidityInput: IncreaseLiquidityInput,
    wallet?: Address,
    funder?: Address
  ) => Promise<{ positionMint: PublicKey; tx: TransactionBuilder }>;

  /**
   * Withdraw all tokens from a position, close the account and burn the position token.
   *
   * Users have to collect all fees and rewards from this position prior to closing the account.
   *
   * If `positionWallet`, `payer` is provided, the wallet owner has to sign this transaction.
   *
   * @param positionAddress - The address of the position account.
   * @param slippageTolerance - The amount of slippage the caller is willing to accept when withdrawing liquidity.
   * @param destinationWallet - The wallet that the tokens withdrawn and rent lamports will be sent to. If null, the WhirlpoolContext wallet is used.
   * @param positionWallet - The wallet that houses the position token that corresponds to this position address. If null, the WhirlpoolContext wallet is used.
   * @param payer - the wallet that will fund the cost needed to initialize the token ATA accounts. If null, the WhirlpoolContext wallet is used.
   */
  closePosition: (
    positionAddress: Address,
    slippageTolerance: Percentage,
    destinationWallet?: Address,
    positionWallet?: Address,
    payer?: Address
  ) => Promise<TransactionBuilder[]>;

  /**
   * Perform a swap between tokenA and tokenB on this pool.
   *
   * @param input - A quote on the desired tokenIn and tokenOut for this swap. Use @link {swapQuote} to generate this object.
   * @param wallet - The wallet that tokens will be withdrawn and deposit into. If null, the WhirlpoolContext wallet is used.
   * @return a transaction that will perform the swap once executed.
   */
  swap: (input: SwapInput, wallet?: PublicKey) => Promise<TransactionBuilder>;

  /**
   * Collect a developer fee and perform a swap between tokenA and tokenB on this pool.
   *
   * @param input - A quote on the desired tokenIn and tokenOut for this swap. Use @link {swapQuote} to generate this object.
   * @param devFeeWallet - The wallet that developer fees will be deposited into.
   * @param wallet - The wallet that swap tokens will be withdrawn and deposit into. If null, the WhirlpoolContext wallet is used.
   * @param payer - The wallet that will fund the cost needed to initialize the dev wallet token ATA accounts. If null, the WhirlpoolContext wallet is used.
   * @return a transaction that will perform the swap once executed.
   */
  swapWithDevFees: (
    input: DevFeeSwapInput,
    devFeeWallet: PublicKey,
    wallet?: PublicKey,
    payer?: PublicKey
  ) => Promise<TransactionBuilder>;
}

/**
 * Helper class to interact with a Position account and build complex transactions.
 * @category WhirlpoolClient
 */
export interface Position {
  /**
   * Return the address for this Whirlpool instance.
   * @return the PublicKey for this Whirlpool instance.
   */
  getAddress: () => PublicKey;

  /**
   * Return the most recently fetched Position account data.
   * @return most recently fetched PositionData for this address.
   */
  getData: () => PositionData;

  /**
   * Return the most recently fetched Whirlpool account data for this position.
   * @return most recently fetched WhirlpoolData for this position.
   */
  getWhirlpoolData: () => WhirlpoolData;

  /**
   * Return the most recently fetched TickData account data for this position's lower tick.
   * @return most recently fetched TickData for this position's lower tick.
   */
  getLowerTickData: () => TickData;

  /**
   * Return the most recently fetched TickData account data for this position's upper tick.
   * @return most recently fetched TickData for this position's upper tick.
   */
  getUpperTickData: () => TickData;

  /**
   * Fetch and return the most recently fetched Position account data.
   * @return the most up to date PositionData for this address.
   */
  refreshData: () => Promise<PositionData>;

  /**
   * Deposit additional tokens into this postiion.
   * The wallet must contain the position token and the necessary token A & B to complete the deposit.
   * If  `positionWallet` and `wallet` is provided, the wallet owners have to sign this transaction.
   *
   * @param liquidityInput - input that defines the desired liquidity amount and maximum tokens willing to be to deposited.
   * @param resolveATA - if true, add instructions to create associated token accounts for tokenA,B for the destinationWallet if necessary. (RPC call required)
   * @param wallet - to withdraw tokens to deposit into the position. If null, the WhirlpoolContext wallet is used.
   * @param positionWallet - the wallet to that houses the position token. If null, the WhirlpoolContext wallet is used.
   * @param ataPayer - wallet that will fund the creation of the new associated token accounts
   * @return the transaction that will deposit the tokens into the position when executed.
   */
  increaseLiquidity: (
    liquidityInput: IncreaseLiquidityInput,
    resolveATA?: boolean,
    wallet?: Address,
    positionWallet?: Address,
    ataPayer?: Address
  ) => Promise<TransactionBuilder>;

  /**
   * Withdraw liquidity from this position.
   *
   * If `positionWallet` is provided, the wallet owners have to sign this transaction.
   *
   * @param liquidityInput - input that defines the desired liquidity amount and minimum tokens willing to be to withdrawn from the position.
   * @param resolveATA -  if true, add instructions to create associated token accounts for tokenA,B for the destinationWallet if necessary. (RPC call required)
   * @param destinationWallet - the wallet to deposit tokens into when withdrawing from the position. If null, the WhirlpoolContext wallet is used.
   * @param positionWallet - the wallet to that houses the position token. If null, the WhirlpoolContext wallet is used.
   * @param ataPayer - wallet that will fund the creation of the new associated token accounts
   * @return the transaction that will deposit the tokens into the position when executed.
   */
  decreaseLiquidity: (
    liquidityInput: DecreaseLiquidityInput,
    resolveATA?: boolean,
    destinationWallet?: Address,
    positionWallet?: Address,
    ataPayer?: Address
  ) => Promise<TransactionBuilder>;

  /**
   * Collect fees from this position
   *
   * If `positionWallet` is provided, the wallet owners have to sign this transaction.
   *
   * @param updateFeesAndRewards -  if true, add instructions to refresh the accumulated fees and rewards data (default to true unless you know that the collect fees quote and on-chain data match for the "feeOwedA" and "feeOwedB" fields in the Position account)
   * @param ownerTokenAccountsRecord - A record that maps a given mint to the owner's token account for that mint (if an entry doesn't exist, it will be automatically resolved)
   * @param destinationWallet - the wallet to deposit tokens into when withdrawing from the position. If null, the WhirlpoolContext wallet is used.
   * @param positionWallet - the wallet to that houses the position token. If null, the WhirlpoolContext wallet is used.
   * @param ataPayer - wallet that will fund the creation of the new associated token accounts
   * @param refresh - set to true to bypass cached on-chain data
   * @return the transaction that will collect fees from the position
   */
  collectFees: (
    updateFeesAndRewards?: boolean,
    ownerTokenAccountsRecord?: Partial<Record<string, Address>>,
    destinationWallet?: Address,
    positionWallet?: Address,
    ataPayer?: Address,
    refresh?: boolean
  ) => Promise<TransactionBuilder>;

  /**
   * Collect rewards from this position
   *
   * If `positionWallet` is provided, the wallet owners have to sign this transaction.
   *
   * @param rewardsToCollect - reward mints to collect (omitting this parameter means all rewards will be collected)
   * @param updateFeesAndRewards -  if true, add instructions to refresh the accumulated fees and rewards data (default to true unless you know that the collect fees quote and on-chain data match for the "feeOwedA" and "feeOwedB" fields in the Position account)
   * @param ownerTokenAccountsRecord - A record that maps a given mint to the owner's token account for that mint (if an entry doesn't exist, it will be automatically resolved)
   * @param destinationWallet - the wallet to deposit tokens into when withdrawing from the position. If null, the WhirlpoolContext wallet is used.
   * @param positionWallet - the wallet to that houses the position token. If null, the WhirlpoolContext wallet is used.
   * @param ataPayer - wallet that will fund the creation of the new associated token accounts
   * @param refresh - set to true to bypass cached on-chain data
   * @return the transaction that will collect fees from the position
   */
  collectRewards: (
    rewardsToCollect?: Address[],
    updateFeesAndRewards?: boolean,
    ownerTokenAccountsRecord?: Partial<Record<string, Address>>,
    destinationWallet?: Address,
    positionWallet?: Address,
    ataPayer?: Address,
    refresh?: boolean
  ) => Promise<TransactionBuilder>;
}
