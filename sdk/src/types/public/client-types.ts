import { PublicKey } from "@solana/web3.js";
import { MintInfo } from "@solana/spl-token";

/**
 * Extended MintInfo class to host token info.
 * @category WhirlpoolClient
 */
export type TokenInfo = MintInfo & { mint: PublicKey };
