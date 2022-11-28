import { PublicKey } from "@solana/web3.js";
import { AccountInfo, MintInfo, u64 } from "@solana/spl-token";
import { TickArrayData, WhirlpoolRewardInfoData } from "./anchor-types";
import { Address } from "@project-serum/anchor";

/**
 * Extended MintInfo class to host token info.
 * @category WhirlpoolClient
 */
export type TokenInfo = MintInfo & { mint: PublicKey };

export type TokenAccountInfo = AccountInfo;

export type WhirlpoolRewardInfo = WhirlpoolRewardInfoData & {
  initialized: boolean;
  vaultAmount: u64;
};

/**
 * A wrapper class of a TickArray on a Whirlpool
 * @category WhirlpoolClient
 */
export type TickArray = {
  address: PublicKey;
  data: TickArrayData | null;
};

/**
 * Params for getting a filtered list of whirlpools.
 */
export type GetPoolsParams = {
  /**
   * Whirlpool program address.
   */
  programId: Address;
  /**
   * WhirlpoolsConfig account address.
   */
  configId: Address;
};
