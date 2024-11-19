import type { AddressLookupTableAccount, PublicKey } from "@solana/web3.js";

export interface LookupTable {
  address: string;
  containedAddresses: string[];
}

/**
 * Interface for fetching lookup tables for a set of addresses.
 *
 * Implementations of this class is expected to cache the lookup tables for quicker read lookups.
 */
export interface LookupTableFetcher {
  /**
   * Given a set of public key addresses, fetches the lookup table accounts that contains these addresses
   * and caches them for future lookups.
   * @param addresses The addresses to fetch lookup tables for.
   * @return The lookup tables that contains the given addresses.
   */
  loadLookupTables(addresses: PublicKey[]): Promise<LookupTable[]>;

  /**
   * Given a set of public key addresses, fetches the lookup table accounts that contains these addresses.
   * @param addresses - The addresses to fetch lookup tables for.
   * @return The lookup table accounts that contains the given addresses.
   */
  getLookupTableAccountsForAddresses(
    addresses: PublicKey[],
  ): Promise<AddressLookupTableAccount[]>;
}
