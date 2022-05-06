import { PublicKey } from "@solana/web3.js";
import { MintInfo } from "@solana/spl-token";

export type TokenInfo = MintInfo & { mint: PublicKey };
