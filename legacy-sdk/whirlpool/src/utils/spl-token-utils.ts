import { NATIVE_MINT } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";

export function isNativeMint(mint: PublicKey) {
  return mint.equals(NATIVE_MINT);
}
