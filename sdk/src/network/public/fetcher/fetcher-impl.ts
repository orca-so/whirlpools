import { Address } from "@coral-xyz/anchor";
import {
  AccountFetcher,
  ParsableEntity,
  ParsableMintInfo,
  ParsableTokenAccountInfo,
  SimpleAccountFetcher,
  MintWithTokenProgram,
  AccountWithTokenProgram as TokenAccountWithTokenProgram,
} from "@orca-so/common-sdk";
import { AccountLayout, Mint, Account as TokenAccount } from "@solana/spl-token";
import { Connection } from "@solana/web3.js";
import {
  DEFAULT_WHIRLPOOL_RETENTION_POLICY,
  WhirlpoolAccountFetchOptions,
  WhirlpoolAccountFetcherInterface,
  WhirlpoolSupportedTypes,
} from "..";
import {
  FeeTierData,
  PositionBundleData,
  PositionData,
  TickArrayData,
  TokenBadgeData,
  WhirlpoolData,
  WhirlpoolsConfigData,
  WhirlpoolsConfigExtensionData,
} from "../../../types/public";
import {
  ParsableFeeTier,
  ParsablePosition,
  ParsablePositionBundle,
  ParsableTickArray,
  ParsableWhirlpool,
  ParsableWhirlpoolsConfig,
  ParsableWhirlpoolsConfigExtension,
  ParsableTokenBadge,
} from "../parsing";

/**
 * Build a default instance of {@link WhirlpoolAccountFetcherInterface} with the default {@link AccountFetcher} implementation
 * @param connection An instance of {@link Connection} to use for fetching accounts
 * @returns An instance of {@link WhirlpoolAccountFetcherInterface}
 * @category Network
 */
export const buildDefaultAccountFetcher = (connection: Connection) => {
  return new WhirlpoolAccountFetcher(
    connection,
    new SimpleAccountFetcher(connection, DEFAULT_WHIRLPOOL_RETENTION_POLICY)
  );
};

/**
 * Fetcher and cache layer for fetching {@link WhirlpoolSupportedTypes} from the network
 * Default implementation for {@link WhirlpoolAccountFetcherInterface}
 * @category Network
 */
export class WhirlpoolAccountFetcher implements WhirlpoolAccountFetcherInterface {
  private _accountRentExempt: number | undefined;

  constructor(
    readonly connection: Connection,
    readonly fetcher: AccountFetcher<WhirlpoolSupportedTypes, WhirlpoolAccountFetchOptions>
  ) {}

  async getAccountRentExempt(refresh: boolean = false): Promise<number> {
    // This value should be relatively static or at least not break according to spec
    // https://docs.solana.com/developing/programming-model/accounts#rent-exemption
    if (!this._accountRentExempt || refresh) {
      this._accountRentExempt = await this.connection.getMinimumBalanceForRentExemption(
        AccountLayout.span
      );
    }
    return this._accountRentExempt;
  }

  getPool(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<WhirlpoolData | null> {
    return this.fetcher.getAccount(address, ParsableWhirlpool, opts);
  }
  getPools(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, WhirlpoolData | null>> {
    return this.fetcher.getAccounts(addresses, ParsableWhirlpool, opts);
  }
  getPosition(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<PositionData | null> {
    return this.fetcher.getAccount(address, ParsablePosition, opts);
  }
  getPositions(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, PositionData | null>> {
    return this.fetcher.getAccounts(addresses, ParsablePosition, opts);
  }
  getTickArray(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<TickArrayData | null> {
    return this.fetcher.getAccount(address, ParsableTickArray, opts);
  }
  getTickArrays(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyArray<TickArrayData | null>> {
    return this.fetcher.getAccountsAsArray(addresses, ParsableTickArray, opts);
  }
  getFeeTier(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<FeeTierData | null> {
    return this.fetcher.getAccount(address, ParsableFeeTier, opts);
  }
  getFeeTiers(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, FeeTierData | null>> {
    return this.fetcher.getAccounts(addresses, ParsableFeeTier, opts);
  }
  getTokenInfo(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<TokenAccountWithTokenProgram | null> {
    return this.fetcher.getAccount(address, ParsableTokenAccountInfo, opts);
  }
  getTokenInfos(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, TokenAccountWithTokenProgram | null>> {
    return this.fetcher.getAccounts(addresses, ParsableTokenAccountInfo, opts);
  }
  getMintInfo(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<MintWithTokenProgram | null> {
    return this.fetcher.getAccount(address, ParsableMintInfo, opts);
  }
  getMintInfos(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, MintWithTokenProgram | null>> {
    return this.fetcher.getAccounts(addresses, ParsableMintInfo, opts);
  }
  getConfig(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<WhirlpoolsConfigData | null> {
    return this.fetcher.getAccount(address, ParsableWhirlpoolsConfig, opts);
  }
  getConfigs(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, WhirlpoolsConfigData | null>> {
    return this.fetcher.getAccounts(addresses, ParsableWhirlpoolsConfig, opts);
  }
  getPositionBundle(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<PositionBundleData | null> {
    return this.fetcher.getAccount(address, ParsablePositionBundle, opts);
  }
  getPositionBundles(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, PositionBundleData | null>> {
    return this.fetcher.getAccounts(addresses, ParsablePositionBundle, opts);
  }

  getConfigExtension(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<WhirlpoolsConfigExtensionData | null> {
    return this.fetcher.getAccount(address, ParsableWhirlpoolsConfigExtension, opts);
  }
  getConfigExtensions(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, WhirlpoolsConfigExtensionData | null>> {
    return this.fetcher.getAccounts(addresses, ParsableWhirlpoolsConfigExtension, opts);
  }

  getTokenBadge(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<TokenBadgeData | null> {
    return this.fetcher.getAccount(address, ParsableTokenBadge, opts);
  }
  getTokenBadges(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, TokenBadgeData | null>> {
    return this.fetcher.getAccounts(addresses, ParsableTokenBadge, opts);
  }


  populateCache<T extends WhirlpoolSupportedTypes>(
    accounts: ReadonlyMap<string, T>,
    parser: ParsableEntity<T>,
    now = Date.now()
  ): void {
    this.fetcher.populateAccounts(accounts, parser, now);
  }
}
