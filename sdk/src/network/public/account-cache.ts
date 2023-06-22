import { AccountCache, Address, BasicSupportedTypes, ParsableEntity, ParsableMintInfo, ParsableTokenAccountInfo, RetentionPolicy, SimpleAccountCache, SimpleAccountFetchOptions } from "@orca-so/common-sdk";
import { AccountLayout, Mint, Account as TokenAccount } from "@solana/spl-token";
import { Connection } from "@solana/web3.js";
import { ParsableFeeTier, ParsablePosition, ParsablePositionBundle, ParsableTickArray, ParsableWhirlpool, ParsableWhirlpoolsConfig } from "../..";
import { FeeTierData, PositionBundleData, PositionData, TickArrayData, WhirlpoolData, WhirlpoolsConfigData } from "../../types/public";

export type WhirlpoolSupportedTypes = WhirlpoolsConfigData
  | WhirlpoolData
  | PositionData
  | TickArrayData
  | FeeTierData
  | PositionBundleData
  | BasicSupportedTypes

export const DEFAULT_WHIRLPOOL_RETENTION_POLICY: ReadonlyMap<ParsableEntity<WhirlpoolSupportedTypes>, number> = new Map<ParsableEntity<WhirlpoolSupportedTypes>, number>([
  [ParsableWhirlpool, 8 * 1000],
  [ParsableTickArray, 8 * 1000]
]);

export type WhirlpoolAccountFetchOptions = SimpleAccountFetchOptions

export const PREFER_REFRESH: WhirlpoolAccountFetchOptions = { maxAge: 0 };
export const AVOID_REFRESH: WhirlpoolAccountFetchOptions = { maxAge: Number.POSITIVE_INFINITY };

export interface WhirlpoolAccountFetcherInterface extends AccountCache<WhirlpoolSupportedTypes, WhirlpoolAccountFetchOptions> {
  getAccountRentExempt(refresh?: boolean): Promise<number>
  getPool(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<WhirlpoolData | null>
  getPools(addresses: Address[], opts?: WhirlpoolAccountFetchOptions): Promise<ReadonlyMap<string, WhirlpoolData | null>>
  getPosition(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<PositionData | null>
  getPositions(addresses: Address[], opts?: WhirlpoolAccountFetchOptions): Promise<ReadonlyMap<string, PositionData | null>>
  getTickArray(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<TickArrayData | null>
  getTickArrays(addresses: Address[], opts?: WhirlpoolAccountFetchOptions): Promise<ReadonlyArray<TickArrayData | null>>
  getFeeTier(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<FeeTierData | null>
  getFeeTiers(addresses: Address[], opts?: WhirlpoolAccountFetchOptions): Promise<ReadonlyMap<string, FeeTierData | null>>
  getTokenInfo(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<TokenAccount | null>
  getTokenInfos(addresses: Address[], opts?: WhirlpoolAccountFetchOptions): Promise<ReadonlyMap<string, TokenAccount | null>>
  getMintInfo(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<Mint | null>
  getMintInfos(addresses: Address[], opts?: WhirlpoolAccountFetchOptions): Promise<ReadonlyMap<string, Mint | null>>
  getConfig(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<WhirlpoolsConfigData | null>
  getConfigs(addresses: Address[], opts?: WhirlpoolAccountFetchOptions): Promise<ReadonlyMap<string, WhirlpoolsConfigData | null>>
  getPositionBundle(address: Address, opts?: WhirlpoolAccountFetchOptions): Promise<PositionBundleData | null>
  getPositionBundles(addresses: Address[], opts?: WhirlpoolAccountFetchOptions): Promise<ReadonlyMap<string, PositionBundleData | null>>
}

export class WhirlpoolAccountFetcher extends SimpleAccountCache<WhirlpoolSupportedTypes, WhirlpoolAccountFetchOptions> implements WhirlpoolAccountFetcherInterface {
  private _accountRentExempt: number | undefined;

  constructor(readonly connection: Connection, readonly retentionPolicy: RetentionPolicy<WhirlpoolSupportedTypes>) {
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

  getPool(address: Address, opts?: WhirlpoolAccountFetchOptions | undefined): Promise<WhirlpoolData | null> {
    return super.getAccount(address, ParsableWhirlpool, opts);
  }
  getPools(addresses: Address[], opts?: WhirlpoolAccountFetchOptions | undefined): Promise<ReadonlyMap<string, WhirlpoolData | null>> {
    return super.getAccounts(addresses, ParsableWhirlpool, opts);
  }
  getPosition(address: Address, opts?: WhirlpoolAccountFetchOptions | undefined): Promise<PositionData | null> {
    return super.getAccount(address, ParsablePosition, opts);
  }
  getPositions(addresses: Address[], opts?: WhirlpoolAccountFetchOptions | undefined): Promise<ReadonlyMap<string, PositionData | null>> {
    return super.getAccounts(addresses, ParsablePosition, opts);
  }
  getTickArray(address: Address, opts?: WhirlpoolAccountFetchOptions | undefined): Promise<TickArrayData | null> {
    return super.getAccount(address, ParsableTickArray, opts);
  }
  getTickArrays(addresses: Address[], opts?: WhirlpoolAccountFetchOptions | undefined): Promise<ReadonlyArray<TickArrayData | null>> {
    return super.getAccountsAsArray(addresses, ParsableTickArray, opts);
  }
  getFeeTier(address: Address, opts?: WhirlpoolAccountFetchOptions | undefined): Promise<FeeTierData | null> {
    return super.getAccount(address, ParsableFeeTier, opts);
  }
  getFeeTiers(addresses: Address[], opts?: WhirlpoolAccountFetchOptions | undefined): Promise<ReadonlyMap<string, FeeTierData | null>> {
    return super.getAccounts(addresses, ParsableFeeTier, opts);
  }
  getTokenInfo(address: Address, opts?: WhirlpoolAccountFetchOptions | undefined): Promise<TokenAccount | null> {
    return super.getAccount(address, ParsableTokenAccountInfo, opts);
  }
  getTokenInfos(addresses: Address[], opts?: WhirlpoolAccountFetchOptions | undefined): Promise<ReadonlyMap<string, TokenAccount | null>> {
    return super.getAccounts(addresses, ParsableTokenAccountInfo, opts);
  }
  getMintInfo(address: Address, opts?: WhirlpoolAccountFetchOptions | undefined): Promise<Mint | null> {
    return super.getAccount(address, ParsableMintInfo, opts);
  }
  getMintInfos(addresses: Address[], opts?: WhirlpoolAccountFetchOptions | undefined): Promise<ReadonlyMap<string, Mint | null>> {
    return super.getAccounts(addresses, ParsableMintInfo, opts);
  }
  getConfig(address: Address, opts?: WhirlpoolAccountFetchOptions | undefined): Promise<WhirlpoolsConfigData | null> {
    return super.getAccount(address, ParsableWhirlpoolsConfig, opts);
  }
  getConfigs(addresses: Address[], opts?: WhirlpoolAccountFetchOptions | undefined): Promise<ReadonlyMap<string, WhirlpoolsConfigData | null>> {
    return super.getAccounts(addresses, ParsableWhirlpoolsConfig, opts);
  }
  getPositionBundle(address: Address, opts?: WhirlpoolAccountFetchOptions | undefined): Promise<PositionBundleData | null> {
    return super.getAccount(address, ParsablePositionBundle, opts);
  }
  getPositionBundles(addresses: Address[], opts?: WhirlpoolAccountFetchOptions | undefined): Promise<ReadonlyMap<string, PositionBundleData | null>> {
    return super.getAccounts(addresses, ParsablePositionBundle, opts);
  }
}