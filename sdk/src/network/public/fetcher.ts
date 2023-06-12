import { Address } from "@coral-xyz/anchor";
import { AddressUtil, ParsableEntity, ParsableMintInfo, ParsableTokenAccountInfo, getMultipleAccountsInMap } from "@orca-so/common-sdk";
import { Account, AccountLayout, Mint } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";
import {
  AccountName,
  PositionBundleData,
  PositionData,
  TickArrayData,
  WHIRLPOOL_CODER,
  WhirlpoolData,
  WhirlpoolsConfigData,
} from "../..";
import { FeeTierData, getAccountSize } from "../../types/public";
import {
  ParsableFeeTier,
  ParsablePosition,
  ParsablePositionBundle,
  ParsableTickArray,
  ParsableWhirlpool,
  ParsableWhirlpoolsConfig,
} from "./parsing";

/**
 * Supported accounts
 */
type CachedValue =
  | WhirlpoolsConfigData
  | WhirlpoolData
  | PositionData
  | TickArrayData
  | FeeTierData
  | PositionBundleData
  | Account
  | Mint;

/**
 * Include both the entity (i.e. type) of the stored value, and the value itself
 */
interface CachedContent<T extends CachedValue> {
  entity: ParsableEntity<T>;
  value: CachedValue | null;
}

/**
 * Filter params for Whirlpools when invoking getProgramAccounts.
 * @category Fetcher
 */
export type ListWhirlpoolParams = {
  programId: Address;
  configId: Address;
};

/**
 * Tuple containing Whirlpool address and parsed account data.
 * @category Fetcher
 */
export type WhirlpoolAccount = [Address, WhirlpoolData];

/**
 * Data access layer to access Whirlpool related accounts
 * Includes internal cache that can be refreshed by the client.
 *
 * @category Fetcher
 */
export class AccountFetcher {
  private readonly connection: Connection;
  private readonly _cache: Record<string, CachedContent<CachedValue>> = {};
  private _accountRentExempt: number | undefined;

  constructor(connection: Connection, cache?: Record<string, CachedContent<CachedValue>>) {
    this.connection = connection;
    this._cache = cache ?? {};
  }

  /*** Public Methods ***/

  /**
   * Retrieve minimum balance for rent exemption of a Token Account;
   *
   * @param refresh force refresh of account rent exemption
   * @returns minimum balance for rent exemption
   */
  public async getAccountRentExempt(refresh: boolean = false) {
    // This value should be relatively static or at least not break according to spec
    // https://docs.solana.com/developing/programming-model/accounts#rent-exemption
    if (!this._accountRentExempt || refresh) {
      this._accountRentExempt = await this.connection.getMinimumBalanceForRentExemption(
        AccountLayout.span
      );
    }
    return this._accountRentExempt;
  }

  /**
   * Retrieve a cached whirlpool account. Fetch from rpc on cache miss.
   *
   * @param address whirlpool address
   * @param refresh force cache refresh
   * @returns whirlpool account
   */
  public async getPool(address: Address, refresh = false): Promise<WhirlpoolData | null> {
    return this.get(AddressUtil.toPubKey(address), ParsableWhirlpool, refresh);
  }

  /**
   * Retrieve a cached position account. Fetch from rpc on cache miss.
   *
   * @param address position address
   * @param refresh force cache refresh
   * @returns position account
   */
  public async getPosition(address: Address, refresh = false): Promise<PositionData | null> {
    return this.get(AddressUtil.toPubKey(address), ParsablePosition, refresh);
  }

  /**
   * Retrieve a cached tick array account. Fetch from rpc on cache miss.
   *
   * @param address tick array address
   * @param refresh force cache refresh
   * @returns tick array account
   */
  public async getTickArray(address: Address, refresh = false): Promise<TickArrayData | null> {
    return this.get(AddressUtil.toPubKey(address), ParsableTickArray, refresh);
  }

  /**
   * Retrieve a cached fee tier account. Fetch from rpc on cache miss.
   *
   * @param address fee tier address
   * @param refresh force cache refresh
   * @returns fee tier account
   */
  public async getFeeTier(address: Address, refresh = false): Promise<FeeTierData | null> {
    return this.get(AddressUtil.toPubKey(address), ParsableFeeTier, refresh);
  }

  /**
   * Retrieve a cached token info account. Fetch from rpc on cache miss.
   *
   * @param address token info address
   * @param refresh force cache refresh
   * @returns token info account
   */
  public async getTokenInfo(address: Address, refresh = false): Promise<Account | null> {
    return this.get(AddressUtil.toPubKey(address), ParsableTokenAccountInfo, refresh);
  }

  /**
   * Retrieve a cached mint info account. Fetch from rpc on cache miss.
   *
   * @param address mint info address
   * @param refresh force cache refresh
   * @returns mint info account
   */
  public async getMintInfo(address: Address, refresh = false): Promise<Mint | null> {
    return this.get(AddressUtil.toPubKey(address), ParsableMintInfo, refresh);
  }

  /**
   * Retrieve a cached whirlpool config account. Fetch from rpc on cache miss.
   *
   * @param address whirlpool config address
   * @param refresh force cache refresh
   * @returns whirlpool config account
   */
  public async getConfig(address: Address, refresh = false): Promise<WhirlpoolsConfigData | null> {
    return this.get(AddressUtil.toPubKey(address), ParsableWhirlpoolsConfig, refresh);
  }

  /**
   * Retrieve a cached position bundle account. Fetch from rpc on cache miss.
   *
   * @param address position bundle address
   * @param refresh force cache refresh
   * @returns position bundle account
   */
  public async getPositionBundle(
    address: Address,
    refresh = false
  ): Promise<PositionBundleData | null> {
    return this.get(AddressUtil.toPubKey(address), ParsablePositionBundle, refresh);
  }

  /**
   * Retrieve a list of cached whirlpool accounts. Fetch from rpc for cache misses.
   *
   * @param addresses whirlpool addresses
   * @param refresh force cache refresh
   * @returns whirlpool accounts
   */
  public async listPools(
    addresses: Address[],
    refresh: boolean
  ): Promise<(WhirlpoolData | null)[]> {
    return this.list(AddressUtil.toPubKeys(addresses), ParsableWhirlpool, refresh);
  }

  /**
   * Retrieve a list of cached whirlpool addresses and accounts filtered by the given params using
   * getProgramAccounts.
   *
   * @param params whirlpool filter params
   * @returns tuple of whirlpool addresses and accounts
   */
  public async listPoolsWithParams({
    programId,
    configId,
  }: ListWhirlpoolParams): Promise<WhirlpoolAccount[]> {
    const filters = [
      { dataSize: getAccountSize(AccountName.Whirlpool) },
      {
        memcmp: WHIRLPOOL_CODER.memcmp(
          AccountName.Whirlpool,
          AddressUtil.toPubKey(configId).toBuffer()
        ),
      },
    ];

    const accounts = await this.connection.getProgramAccounts(AddressUtil.toPubKey(programId), {
      filters,
    });

    const parsedAccounts: WhirlpoolAccount[] = [];
    accounts.forEach(({ pubkey, account }) => {
      const parsedAccount = ParsableWhirlpool.parse(pubkey, account);
      invariant(!!parsedAccount, `could not parse whirlpool: ${pubkey.toBase58()}`);
      parsedAccounts.push([pubkey, parsedAccount]);
      this._cache[pubkey.toBase58()] = { entity: ParsableWhirlpool, value: parsedAccount };
    });

    return parsedAccounts;
  }

  /**
   * Retrieve a list of cached position accounts. Fetch from rpc for cache misses.
   *
   * @param addresses position addresses
   * @param refresh force cache refresh
   * @returns position accounts
   */
  public async listPositions(
    addresses: Address[],
    refresh: boolean
  ): Promise<(PositionData | null)[]> {
    return this.list(AddressUtil.toPubKeys(addresses), ParsablePosition, refresh);
  }

  /**
   * Retrieve a list of cached tick array accounts. Fetch from rpc for cache misses.
   *
   * @param addresses tick array addresses
   * @param refresh force cache refresh
   * @returns tick array accounts
   */
  public async listTickArrays(
    addresses: Address[],
    refresh: boolean
  ): Promise<(TickArrayData | null)[]> {
    return this.list(AddressUtil.toPubKeys(addresses), ParsableTickArray, refresh);
  }

  /**
   * Retrieve a list of cached token info accounts. Fetch from rpc for cache misses.
   *
   * @param addresses token info addresses
   * @param refresh force cache refresh
   * @returns token info accounts
   */
  public async listTokenInfos(
    addresses: Address[],
    refresh: boolean
  ): Promise<(Account | null)[]> {
    return this.list(AddressUtil.toPubKeys(addresses), ParsableTokenAccountInfo, refresh);
  }

  /**
   * Retrieve a list of cached mint info accounts. Fetch from rpc for cache misses.
   *
   * @param addresses mint info addresses
   * @param refresh force cache refresh
   * @returns mint info accounts
   */
  public async listMintInfos(addresses: Address[], refresh: boolean): Promise<(Mint | null)[]> {
    return this.list(AddressUtil.toPubKeys(addresses), ParsableMintInfo, refresh);
  }

  /**
   * Retrieve a list of cached position bundle accounts. Fetch from rpc for cache misses.
   *
   * @param addresses position bundle addresses
   * @param refresh force cache refresh
   * @returns position bundle accounts
   */
  public async listPositionBundles(
    addresses: Address[],
    refresh: boolean
  ): Promise<(PositionBundleData | null)[]> {
    return this.list(AddressUtil.toPubKeys(addresses), ParsablePositionBundle, refresh);
  }

  /**
   * Update the cached value of all entities currently in the cache.
   * Uses batched rpc request for network efficient fetch.
   */
  public async refreshAll(): Promise<void> {
    const addresses: string[] = Object.keys(this._cache);
    const fetchedAccountsMap = await getMultipleAccountsInMap(this.connection, addresses);

    for (const [key, cachedContent] of Object.entries(this._cache)) {
      const entity = cachedContent.entity;
      const fetchedEntry = fetchedAccountsMap.get(key);
      const value = entity.parse(AddressUtil.toPubKey(key), fetchedEntry);

      this._cache[key] = { entity, value };
    }
  }

  /*** Private Methods ***/

  /**
   * Retrieve from cache or fetch from rpc, an account
   */
  private async get<T extends CachedValue>(
    address: PublicKey,
    entity: ParsableEntity<T>,
    refresh: boolean
  ): Promise<T | null> {
    const key = address.toBase58();
    const cachedValue: CachedValue | null | undefined = this._cache[key]?.value;

    if (cachedValue !== undefined && !refresh) {
      return cachedValue as T | null;
    }

    const accountInfo = await this.connection.getAccountInfo(address);
    const value = entity.parse(address, accountInfo);
    this._cache[key] = { entity, value };

    return value;
  }

  /**
   * Retrieve from cache or fetch from rpc, a list of accounts
   */
  private async list<T extends CachedValue>(
    addresses: PublicKey[],
    entity: ParsableEntity<T>,
    refresh: boolean
  ): Promise<(T | null)[]> {
    const keys = addresses.map((address) => address.toBase58());
    const cachedValues: [string, CachedValue | null | undefined][] = keys.map((key) => [
      key,
      refresh ? undefined : this._cache[key]?.value,
    ]);

    /* Look for accounts not found in cache */
    const undefinedAccounts: { cacheIndex: number; key: string }[] = [];
    cachedValues.forEach(([key, value], cacheIndex) => {
      if (value === undefined) {
        undefinedAccounts.push({ cacheIndex, key });
      }
    });

    /* Fetch accounts not found in cache */
    if (undefinedAccounts.length > 0) {
      const fetchedAccountsMap = await getMultipleAccountsInMap(this.connection, undefinedAccounts.map((account) => account.key));
      undefinedAccounts.forEach(({ cacheIndex, key }) => {
        const fetchedEntry = fetchedAccountsMap.get(key);
        const value = entity.parse(AddressUtil.toPubKey(key), fetchedEntry);
        invariant(cachedValues[cacheIndex]?.[1] === undefined, "unexpected non-undefined value");
        cachedValues[cacheIndex] = [key, value];
        this._cache[key] = { entity, value };
      });
    }

    const result = cachedValues
      .map(([_, value]) => value)
      .filter((value): value is T | null => value !== undefined);
    invariant(result.length === addresses.length, "not enough results fetched");
    return result;
  }

}
