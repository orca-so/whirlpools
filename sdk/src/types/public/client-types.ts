import { AccountInfo, MintInfo, u64 } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { TickArrayData, WhirlpoolRewardInfoData } from "./anchor-types";

/**
 * Extended MintInfo type to host token info.
 * @category WhirlpoolClient
 */
export type TokenInfo = MintInfo & { mint: PublicKey };

/**
 * Extended AccountInfo type to host account info for a Token.
 * @category WhirlpoolClient
 */
export type TokenAccountInfo = AccountInfo;

/**
 * Type to represent a reward for a reward index on a Whirlpool.
 * @category WhirlpoolClient
 */
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
