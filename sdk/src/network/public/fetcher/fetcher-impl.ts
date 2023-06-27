import { Address } from "@coral-xyz/anchor";
import { ParsableMintInfo, ParsableTokenAccountInfo, RetentionPolicy, SimpleAccountFetcher } from "@orca-so/common-sdk";
import { AccountLayout, Mint, Account as TokenAccount } from "@solana/spl-token";
import { Connection } from "@solana/web3.js";
import { WhirlpoolAccountFetchOptions, WhirlpoolAccountFetcherInterface, WhirlpoolSupportedTypes } from "..";
import { FeeTierData, PositionBundleData, PositionData, TickArrayData, WhirlpoolData, WhirlpoolsConfigData } from "../../../types/public";
import { ParsableFeeTier, ParsablePosition, ParsablePositionBundle, ParsableTickArray, ParsableWhirlpool, ParsableWhirlpoolsConfig } from "../parsing";

/**
 * Fetcher and cache layer for fetching {@link WhirlpoolSupportedTypes} from the network
 * Default implementation for {@link WhirlpoolAccountFetcherInterface}
 * @category Network
 */
export class WhirlpoolAccountFetcher
  extends SimpleAccountFetcher<WhirlpoolSupportedTypes, WhirlpoolAccountFetchOptions>
  implements WhirlpoolAccountFetcherInterface {
  private _accountRentExempt: number | undefined;

  constructor(
    readonly connection: Connection,
    readonly retentionPolicy: RetentionPolicy<WhirlpoolSupportedTypes>
  ) {
    super(connection, retentionPolicy);
  }

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

  getPool(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<WhirlpoolData | null> {
    return super.getAccount(address, ParsableWhirlpool, opts);
  }
  getPools(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, WhirlpoolData | null>> {
    return super.getAccounts(addresses, ParsableWhirlpool, opts);
  }
  getPosition(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<PositionData | null> {
    return super.getAccount(address, ParsablePosition, opts);
  }
  getPositions(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, PositionData | null>> {
    return super.getAccounts(addresses, ParsablePosition, opts);
  }
  getTickArray(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<TickArrayData | null> {
    return super.getAccount(address, ParsableTickArray, opts);
  }
  getTickArrays(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyArray<TickArrayData | null>> {
    return super.getAccountsAsArray(addresses, ParsableTickArray, opts);
  }
  getFeeTier(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<FeeTierData | null> {
    return super.getAccount(address, ParsableFeeTier, opts);
  }
  getFeeTiers(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, FeeTierData | null>> {
    return super.getAccounts(addresses, ParsableFeeTier, opts);
  }
  getTokenInfo(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<TokenAccount | null> {
    return super.getAccount(address, ParsableTokenAccountInfo, opts);
  }
  getTokenInfos(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, TokenAccount | null>> {
    return super.getAccounts(addresses, ParsableTokenAccountInfo, opts);
  }
  getMintInfo(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<Mint | null> {
    return super.getAccount(address, ParsableMintInfo, opts);
  }
  getMintInfos(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, Mint | null>> {
    return super.getAccounts(addresses, ParsableMintInfo, opts);
  }
  getConfig(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<WhirlpoolsConfigData | null> {
    return super.getAccount(address, ParsableWhirlpoolsConfig, opts);
  }
  getConfigs(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, WhirlpoolsConfigData | null>> {
    return super.getAccounts(addresses, ParsableWhirlpoolsConfig, opts);
  }
  getPositionBundle(
    address: Address,
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<PositionBundleData | null> {
    return super.getAccount(address, ParsablePositionBundle, opts);
  }
  getPositionBundles(
    addresses: Address[],
    opts?: WhirlpoolAccountFetchOptions
  ): Promise<ReadonlyMap<string, PositionBundleData | null>> {
    return super.getAccounts(addresses, ParsablePositionBundle, opts);
  }
}
