import type { Account, Mint } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";

/**
 * @category Parsables
 */
export type MintWithTokenProgram = Mint & { tokenProgram: PublicKey };

/**
 * @category Parsables
 */
export type AccountWithTokenProgram = Account & { tokenProgram: PublicKey };
