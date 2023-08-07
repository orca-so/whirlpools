import { Address } from "@coral-xyz/anchor";
import {
  BasicSupportedTypes,
  ParsableEntity,
  SimpleAccountFetchOptions,
} from "@orca-so/common-sdk";
import { Mint, Account as TokenAccount } from "@solana/spl-token";
import {
  FeeTierData,
  PositionBundleData,
  PositionData,
  TickArrayData,
  WhirlpoolData,
  WhirlpoolsConfigData,
} from "../../../types/public";

/**
 * Union type of all the {@link ParsableEntity} types that can be cached in the {@link WhirlpoolAccountFetcherInterface}
 * @category Network
 */
export type WhirlpoolSupportedTypes =
  | WhirlpoolsConfigData
  | WhirlpoolData
  | PositionData
  | TickArrayData
  | FeeTierData
  | PositionBundleData
  | BasicSupportedTypes;

/**
 * The default retention periods for each {@link ParsableEntity} type in the {@link WhirlpoolAccountFetcherInterface}
 * @category Network
 */
export const DEFAULT_WHIRLPOOL_RETENTION_POLICY: ReadonlyMap<
  ParsableEntity<WhirlpoolSupportedTypes>,
  number
> = new Map<ParsableEntity<WhirlpoolSupportedTypes>, number>([]);

/**
 * Type to define fetch options for the {@link WhirlpoolAccountFetcherInterface}
 * @category Network
 */
export type WhirlpoolAccountFetchOptions = SimpleAccountFetchOptions;

/**
 * Default fetch option for always fetching when making an account request to the {@link WhirlpoolAccountFetcherInterface}
 * @category Network
 */
export const IGNORE_CACHE: WhirlpoolAccountFetchOptions = { maxAge: 0 };

/**
 * Default fetch option for always using the cached value for an account request to the {@link WhirlpoolAccountFetcherInterface}
 * @category Network
 */
export const PREFER_CACHE: WhirlpoolAccountFetchOptions = { maxAge: Number.POSITIVE_INFINITY };

/**
 * Fetcher interface for fetching {@link WhirlpoolSupportedTypes} from the network
 * @category Network
 */
export interface WhirlpoolAccountFetcherInterface {
  /**
   * Fetch and cache the rent exempt value
   * @param refresh If true, will always fetch from the network
   */
  getAccountRentExempt(refresh?: boolean): Promise<number>;

  /**
   * Fetch and cache the account for a given Whirlpool addresses
   * @param address The mint address
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getPool(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<WhirlpoolData | null>;

  /**
   * Fetch and cache the accounts for a given array of Whirlpool addresses
   * @param addresses The array of mint addresses
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getPools(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, WhirlpoolData | null>>;

  /**
   * Fetch and cache the account for a given Position address
   * @param address The address of the position account
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getPosition(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<PositionData | null>;

  /**
   * Fetch and cache the accounts for a given array of Position addresses
   * @param addresses The array of position account addresses
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getPositions(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, PositionData | null>>;

  /**
   * Fetch and cache the account for a given TickArray address.
   * @param address The address of the tick array account
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getTickArray(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<TickArrayData | null>;

  /**
   * Fetch and cache the accounts for a given array of TickArray addresses
   * @param addresses The array of tick array account addresses
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getTickArrays(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyArray<TickArrayData | null>>;

  /**
   * Fetch and cache the account for a given FeeTier address
   * @param address The address of the fee tier account
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getFeeTier(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<FeeTierData | null>;

  /**
   * Fetch and cache the accounts for a given array of FeeTier addresses
   * @param addresses The array of fee tier account addresses
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getFeeTiers(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, FeeTierData | null>>;

  /**
   * Fetch and cache the account for a given TokenAccount address
   * @param address The address of the token account
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getTokenInfo(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<TokenAccount | null>;

  /**
   * Fetch and cache the accounts for a given array of TokenAccount addresses
   * @param addresses The array of token account addresses
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getTokenInfos(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, TokenAccount | null>>;

  /**
   * Fetch and cache the account for a given Mint address
   * @param address The address of the mint account
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getMintInfo(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<Mint | null>;

  /**
   * Fetch and cache the accounts for a given array of Mint addresses
   * @param addresses The array of mint account addresses
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getMintInfos(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, Mint | null>>;

  /**
   * Fetch and cache the account for a given WhirlpoolConfig address
   * @param address The address of the WhirlpoolConfig account
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getConfig(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<WhirlpoolsConfigData | null>;

  /**
   * Fetch and cache the accounts for a given array of WhirlpoolConfig addresses
   * @param addresses The array of WhirlpoolConfig account addresses
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getConfigs(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, WhirlpoolsConfigData | null>>;

  /**
   * Fetch and cache the account for a given PositionBundle address
   * @param address The address of the position bundle account
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getPositionBundle(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<PositionBundleData | null>;

  /**
   * Fetch and cache the accounts for a given array of PositionBundle addresses
   * @param addresses The array of position bundle account addresses
   * @param opts {@link WhirlpoolAccountFetchOptions} instance to dictate fetch behavior
   */
  getPositionBundles(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, PositionBundleData | null>>;

  /**
   * Populate the fetcher's cache with the given {@link WhirlpoolsData} accounts
   * @param accounts The map of addresses to on-chain account data
   * @param parser The {@link ParsableEntity} instance to parse the accounts
   * @param now The current timestamp to use for the cache
   */
  populateCache<T extends WhirlpoolSupportedTypes>(
    accounts: ReadonlyMap<string, T>,
    parser: ParsableEntity<T>,
    now: number
  ): void;
}
