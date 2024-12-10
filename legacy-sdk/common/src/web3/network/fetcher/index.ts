import type {
  AccountWithTokenProgram,
  MintWithTokenProgram,
  ParsableEntity,
} from "..";
import type { Address } from "../../address-util";

export * from "./simple-fetcher-impl";

export type BasicSupportedTypes =
  | AccountWithTokenProgram
  | MintWithTokenProgram;

/**
 * Interface for fetching and caching on-chain accounts
 */
export interface AccountFetcher<T, AccountFetchOptions> {
  /**
   * Fetch an account from the cache or from the network
   * @param address The account address to fetch from cache or network
   * @param parser The parser to used for theses accounts
   * @param opts Options when fetching the accounts
   * @returns
   */
  getAccount: <U extends T>(
    address: Address,
    parser: ParsableEntity<U>,
    opts?: AccountFetchOptions,
  ) => Promise<U | null>;

  /**
   * Fetch multiple accounts from the cache or from the network
   * @param address A list of account addresses to fetch from cache or network
   * @param parser The parser to used for theses accounts
   * @param opts Options when fetching the accounts
   * @returns a Map of addresses to accounts. The ordering of the Map iteration is the same as the ordering of the input addresses.
   */
  getAccounts: <U extends T>(
    address: Address[],
    parser: ParsableEntity<U>,
    opts?: AccountFetchOptions,
  ) => Promise<ReadonlyMap<string, U | null>>;

  /**
   * Fetch multiple accounts from the cache or from the network and return as an array
   * @param address A list of account addresses to fetch from cache or network
   * @param parser The parser to used for theses accounts
   * @param opts Options when fetching the accounts
   * @returns an array of accounts. The ordering of the array is the same as the ordering of the input addresses.
   */
  getAccountsAsArray: <U extends T>(
    address: Address[],
    parser: ParsableEntity<U>,
    opts?: AccountFetchOptions,
  ) => Promise<ReadonlyArray<U | null>>;

  /**
   * Populate the cache with the given accounts.
   * @param accounts A list of accounts addresses to fetched accounts to populate the cache with
   * @param parser The parser that was used to parse theses accounts
   * @param now The timestamp to use for the cache entries
   */
  populateAccounts: <U extends T>(
    accounts: ReadonlyMap<string, U | null>,
    parser: ParsableEntity<U>,
    now: number,
  ) => void;
}
