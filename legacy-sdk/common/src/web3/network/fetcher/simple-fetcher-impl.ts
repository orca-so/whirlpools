import type { Connection } from "@solana/web3.js";
import type { AccountFetcher } from ".";
import type { Address } from "../../address-util";
import { AddressUtil } from "../../address-util";
import { getMultipleAccountsInMap } from "../account-requests";
import type { ParsableEntity } from "../parsing";

type CachedContent<T> = {
  parser: ParsableEntity<T>;
  fetchedAt: number;
  value: T | null;
};

export type RetentionPolicy<T> = ReadonlyMap<ParsableEntity<T>, number>;

/**
 * Options when fetching the accounts
 */
export type SimpleAccountFetchOptions = {
  // Maximum age in milliseconds. Zero always fetches from the network.
  maxAge?: number;
  // Timeout in seconds before the RPC call is considered failed.
  timeoutInSeconds?: number;
};

// SimpleAccountFetcher is a simple implementation of AccountCache that stores the fetched
// accounts in memory. If TTL is not provided, it will use TTL defined in the retention policy
// for the parser. If that is also not provided, the request will always prefer the cache value.
export class SimpleAccountFetcher<
  T,
  FetchOptions extends SimpleAccountFetchOptions,
> implements AccountFetcher<T, FetchOptions>
{
  cache: Map<string, CachedContent<T>> = new Map();
  constructor(
    readonly connection: Connection,
    readonly retentionPolicy: RetentionPolicy<T>,
  ) {
    this.cache = new Map<string, CachedContent<T>>();
  }

  async getAccount<U extends T>(
    address: Address,
    parser: ParsableEntity<U>,
    opts?: FetchOptions | undefined,
    now: number = Date.now(),
  ): Promise<U | null> {
    const addressKey = AddressUtil.toPubKey(address);
    const addressStr = AddressUtil.toString(address);

    const maxAge = this.getMaxAge(this.retentionPolicy.get(parser), opts);
    const cached = this.getFreshEntry(addressStr, now, maxAge);
    if (cached) {
      return cached.value as U | null;
    }

    try {
      const accountInfo = await this.connection.getAccountInfo(addressKey);
      const value = parser.parse(addressKey, accountInfo);
      this.cache.set(addressStr, { parser, value, fetchedAt: now });
      return value;
    } catch {
      // A failed read tells us nothing about the account. Keep the last successful result.
      return null;
    }
  }

  private getMaxAge(
    parserMaxAge?: number,
    opts?: SimpleAccountFetchOptions,
  ): number {
    if (opts?.maxAge !== undefined) {
      return opts.maxAge;
    }
    return parserMaxAge === undefined ? Number.POSITIVE_INFINITY : parserMaxAge;
  }

  private getFreshEntry(address: string, now: number, maxAge: number) {
    const entry = this.cache.get(address);
    if (entry && maxAge !== 0 && now - entry.fetchedAt <= maxAge) {
      return entry;
    }
    return undefined;
  }

  async getAccounts<U extends T>(
    addresses: Address[],
    parser: ParsableEntity<U>,
    opts?: SimpleAccountFetchOptions | undefined,
    now: number = Date.now(),
  ): Promise<ReadonlyMap<string, U | null>> {
    const addressStrs = AddressUtil.toStrings(addresses);
    await this.fetchAndPopulateCache(addressStrs, parser, opts, now);

    // Build a map of the results, insert by the order of the addresses parameter
    const result = new Map<string, U | null>();
    addressStrs.forEach((addressStr) => {
      const cached = this.cache.get(addressStr);
      const value = cached?.value as U | null;
      result.set(addressStr, value);
    });

    return result;
  }

  async getAccountsAsArray<U extends T>(
    addresses: Address[],
    parser: ParsableEntity<U>,
    opts?: FetchOptions | undefined,
    now: number = Date.now(),
  ): Promise<ReadonlyArray<U | null>> {
    const addressStrs = AddressUtil.toStrings(addresses);
    await this.fetchAndPopulateCache(addressStrs, parser, opts, now);

    // Rebuild an array containing the results, insert by the order of the addresses parameter
    const result = new Array<U | null>();
    addressStrs.forEach((addressStr) => {
      const cached = this.cache.get(addressStr);
      const value = cached?.value as U | null;
      result.push(value);
    });

    return result;
  }

  populateAccounts<U extends T>(
    accounts: ReadonlyMap<string, U | null>,
    parser: ParsableEntity<U>,
    now: number,
  ): void {
    Array.from(accounts.entries()).forEach(([key, value]) => {
      this.cache.set(key, { parser, value, fetchedAt: now });
    });
  }

  async refreshAll(now: number = Date.now(), timeoutInSeconds?: number) {
    const addresses = Array.from(this.cache.keys());
    const fetchedAccountsMap = await getMultipleAccountsInMap(
      this.connection,
      addresses,
      timeoutInSeconds,
    );

    for (const [key, cachedContent] of this.cache.entries()) {
      const parser = cachedContent.parser;
      const fetchedEntry = fetchedAccountsMap.get(key);
      const value = parser.parse(AddressUtil.toPubKey(key), fetchedEntry);
      this.cache.set(key, { parser, value, fetchedAt: now });
    }
  }

  private async fetchAndPopulateCache<U extends T>(
    addresses: Address[],
    parser: ParsableEntity<U>,
    opts?: SimpleAccountFetchOptions | undefined,
    now: number = Date.now(),
  ) {
    const addressStrs = AddressUtil.toStrings(addresses);
    const maxAge = this.getMaxAge(this.retentionPolicy.get(parser), opts);

    const addressesToFetch = addressStrs.filter(
      (address) => !this.getFreshEntry(address, now, maxAge),
    );

    // Fetch all undefined accounts and place in cache
    // TODO: We currently do not support contextSlot consistency across the batched getMultipleAccounts call
    // If the addresses list contain accounts in the 1st gMA call as subsequent calls and the gMA returns on different contextSlots,
    // the returned results can be inconsistent and unexpected by the user.
    if (addressesToFetch.length > 0) {
      const fetchedAccountsMap = await getMultipleAccountsInMap(
        this.connection,
        addressesToFetch,
        opts?.timeoutInSeconds,
      );
      addressesToFetch.forEach((key) => {
        const fetchedEntry = fetchedAccountsMap.get(key);
        const value = parser.parse(AddressUtil.toPubKey(key), fetchedEntry);
        this.cache.set(key, { parser, value, fetchedAt: now });
      });
    }
  }
}
