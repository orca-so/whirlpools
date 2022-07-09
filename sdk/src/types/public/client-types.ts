import { PublicKey } from "@solana/web3.js";
import { MintInfo } from "@solana/spl-token";
import { TickArrayData } from "./anchor-types";

/**
 * Extended MintInfo class to host token info.
 * @category WhirlpoolClient
 */
export type TokenInfo = MintInfo & { mint: PublicKey };

/**
 * A wrapper class of a TickArray on a Whirlpool
 * @category WhirlpoolClient
 */
export type TickArray = {
  address: PublicKey;
  data: TickArrayData | null;
};
